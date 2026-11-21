// Generates commands only. The user executes them in foreground PowerShell.
const psQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
function recoveryCommand(vaultRoot, receipt) {
    if (!/^[a-f0-9]{40,64}$/.test(receipt.commit || '')) throw new Error('還原點 commit 無效');
    if (!Array.isArray(receipt.files) || !receipt.files.length) throw new Error('收據沒有發布檔案');
    const files = receipt.files.map(file => {
        if (typeof file.path !== 'string' || !/^(MC-|SF-)[^\\:*?"<>|\r\n]+\.md$/i.test(file.path) ||
            file.path.split('/').some(part => !part || part.startsWith('.') || /[. ]$/.test(part)) ||
            typeof file.created !== 'boolean') throw new Error('收據路徑或 created 欄位無效');
        return file;
    });
    if (new Set(files.map(file => file.path.toLowerCase())).size !== files.length) throw new Error('收據路徑重複');
    for (const file of files.filter(file => !file.created)) {
        if (!/^[a-f0-9]{64}$/.test(file.sourceSHA256 || '')) throw new Error('既有 BIO 缺少發布前 SHA256');
    }
    const existing = files.filter(file => !file.created).map(file => psQuote(file.path)).join(', ');
    const created = files.filter(file => file.created).map(file => psQuote(file.path)).join(', ');
    const expected = files.filter(file => !file.created).map(file =>
        '    @{ Path = ' + psQuote(file.path) + '; SHA256 = ' + psQuote(file.sourceSHA256) + ' }').join('\n');
    return `$ErrorActionPreference = 'Stop'
$VaultRoot = ${psQuote(vaultRoot)}
$Checkpoint = ${psQuote(receipt.commit)}
$Existing = @(${existing})
$Created = @(${created})
$Expected = @(
${expected}
)
$BackupRoot = Join-Path $VaultRoot ('review/bio-recovery/' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
if (Test-Path -LiteralPath $BackupRoot) { throw '備份位置已存在' }
$VaultPrefix = [IO.Path]::GetFullPath($VaultRoot).TrimEnd([char[]]@([char]92, [char]47)) + [IO.Path]::DirectorySeparatorChar
foreach ($Relative in @($Existing) + @($Created)) {
    $Target = [IO.Path]::GetFullPath((Join-Path $VaultRoot $Relative))
    if (!$Target.StartsWith($VaultPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw '路徑超出 Vault' }
    $Cursor = $Target
    while ($Cursor -and $Cursor.Length -ge $VaultPrefix.Length) {
        $Info = Get-Item -LiteralPath $Cursor -Force -ErrorAction SilentlyContinue
        if ($Info -and ($Info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "不支援連結路徑：$Cursor" }
        $Cursor = Split-Path -Parent $Cursor
    }
}
New-Item -ItemType Directory -Path $BackupRoot | Out-Null
foreach ($Relative in @($Existing) + @($Created)) {
    $Target = Join-Path $VaultRoot $Relative
    if (Test-Path -LiteralPath $Target) {
        if (!(Test-Path -LiteralPath $Target -PathType Leaf)) { throw "不是檔案：$Target" }
        $Backup = Join-Path $BackupRoot ('before/' + $Relative)
        New-Item -ItemType Directory -Path (Split-Path -Parent $Backup) -Force | Out-Null
        Copy-Item -LiteralPath $Target -Destination $Backup
        if ((Get-FileHash -LiteralPath $Target).Hash -ne (Get-FileHash -LiteralPath $Backup).Hash) { throw '備份校驗失敗' }
    }
}
$GitExitCode = $null
$GitCompleted = $false
if ($Existing.Count) {
    $GitExe = (Get-Command git.exe -ErrorAction Stop).Source
    $GitArguments = @('--literal-pathspecs', '-C', ('"' + $VaultRoot + '"'), 'restore', ('--source=' + $Checkpoint), '--worktree', '--')
    $GitArguments += @($Existing | ForEach-Object { '"' + $_ + '"' })
    $Process = Start-Process -FilePath $GitExe -ArgumentList $GitArguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $BackupRoot 'restore.stdout.log') -RedirectStandardError (Join-Path $BackupRoot 'restore.stderr.log')
    $GitCompleted = $Process.HasExited
    if ($GitCompleted) { $GitExitCode = $Process.ExitCode }
    if (!$GitCompleted -or $GitExitCode -ne 0) { throw "Git 還原未成功，請查看 $BackupRoot 的日誌；新增檔案尚未搬移。" }
}
foreach ($Entry in $Expected) {
    $Restored = Join-Path $VaultRoot $Entry.Path
    if (!(Test-Path -LiteralPath $Restored -PathType Leaf) -or (Get-FileHash -LiteralPath $Restored).Hash.ToLowerInvariant() -ne $Entry.SHA256) {
        throw "還原內容未通過發布前 SHA256 校驗：$Restored；請查看備份與 Git 換行設定。"
    }
}
# 新建 BIO 在發布前不存在，移到備份區保留，不刪除。
foreach ($Relative in $Created) {
    $Target = [IO.Path]::GetFullPath((Join-Path $VaultRoot $Relative))
    if (!$Target.StartsWith($VaultPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw '搬移路徑超出 Vault' }
    if (Test-Path -LiteralPath $Target) {
        $Destination = Join-Path $BackupRoot ('new-files/' + $Relative)
        New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
        Move-Item -LiteralPath $Target -Destination $Destination
        if ((Test-Path -LiteralPath $Target) -or !(Test-Path -LiteralPath $Destination -PathType Leaf) -or (Get-FileHash -LiteralPath $Destination).Hash -ne (Get-FileHash -LiteralPath (Join-Path $BackupRoot ('before/' + $Relative))).Hash) {
            throw "新增檔案搬移後校驗失敗：$Relative"
        }
    }
}
Write-Host "還原操作完成；請檢查 BIO 與 V4。操作前內容保留在：$BackupRoot"
`;
}
function inspectCommand(vaultRoot, commit) {
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error('commit 無效');
    return `$VaultRoot = ${psQuote(vaultRoot)}
$GitExe = (Get-Command git.exe -ErrorAction Stop).Source
$LogRoot = Join-Path $VaultRoot ('review/git-history/' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
if (Test-Path -LiteralPath $LogRoot) { throw '日誌位置已存在' }
New-Item -ItemType Directory -Path $LogRoot -Force | Out-Null
$GitExitCode = $null
$GitCompleted = $false
$Process = Start-Process -FilePath $GitExe -ArgumentList @('-C', ('"' + $VaultRoot + '"'), 'show', '--stat', '--oneline', '${commit}') -Wait -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $LogRoot 'show.stdout.log') -RedirectStandardError (Join-Path $LogRoot 'show.stderr.log')
$GitCompleted = $Process.HasExited
if ($GitCompleted) { $GitExitCode = $Process.ExitCode }
[pscustomobject]@{ Completed = $GitCompleted; ExitCode = $GitExitCode; Logs = $LogRoot }
Get-Content -LiteralPath (Join-Path $LogRoot 'show.stdout.log')
Get-Content -LiteralPath (Join-Path $LogRoot 'show.stderr.log')
`;
}
module.exports = { recoveryCommand, inspectCommand };
