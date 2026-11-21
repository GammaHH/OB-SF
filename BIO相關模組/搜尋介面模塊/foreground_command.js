const psQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
// Start-Process joins arguments on Windows: quote using the native argv rules.
const windowsQuote = value => '"' + String(value).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
function foregroundCommand(root, args, label = 'obsf') {
    if (!/^[a-z0-9_-]+$/i.test(label) || !Array.isArray(args) || !args.length) throw new Error('Command arguments invalid');
    return `Set-Location -LiteralPath ${psQuote(root)}
$LogDir = Join-Path $PWD (${psQuote('logs/' + label + '-')} + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
if (Test-Path -LiteralPath $LogDir) { throw 'Log directory already exists' }
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$Stdout = Join-Path $LogDir 'stdout.log'
$Stderr = Join-Path $LogDir 'stderr.log'
$RunExitCode = $null
$RunCompleted = $false
$NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$RunArguments = @(
${args.map(value=>'    '+psQuote(windowsQuote(value))).join('\n')}
)
$Process = Start-Process -FilePath $NodeExe -ArgumentList $RunArguments -Wait -PassThru -NoNewWindow -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr
$RunCompleted = $Process.HasExited
if ($RunCompleted) { $RunExitCode = $Process.ExitCode }
[pscustomobject]@{ Completed = $RunCompleted; ExitCode = $RunExitCode; Stdout = $Stdout; Stderr = $Stderr }
Get-Content -LiteralPath $Stdout -Tail 60
Get-Content -LiteralPath $Stderr -Tail 35
`;
}
module.exports = { foregroundCommand, windowsQuote };
