param(
    [Parameter(Mandatory = $true)][string]$SourceFolder,
    [Parameter(Mandatory = $true)][string]$ArchiveFile,
    [Parameter(Mandatory = $true)][string]$ExcludedEntry
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression

$Root = (Get-Item -LiteralPath $SourceFolder -Force).FullName
$Directories = [System.Collections.Generic.Stack[string]]::new()
$Directories.Push($Root)
$Files = [System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
while ($Directories.Count) {
    foreach ($Item in Get-ChildItem -LiteralPath ($Directories.Pop()) -Force) {
        if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Cannot archive reparse point: $($Item.FullName)"
        }
        $Name = $Item.FullName.Substring($Root.Length + 1).Replace('\', '/')
        if ($Name -ceq $ExcludedEntry) { continue }
        if ($Item.PSIsContainer) { $Directories.Push($Item.FullName) }
        else { $Files.Add($Name, $Item.FullName) }
    }
}
if (!$Files.Count) { throw 'The archive has no files.' }

$FileStream = [IO.File]::Open($ArchiveFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
try {
    $Zip = [IO.Compression.ZipArchive]::new($FileStream, [IO.Compression.ZipArchiveMode]::Create, $true, [Text.Encoding]::UTF8)
    try {
        foreach ($File in $Files.GetEnumerator()) {
            $Entry = $Zip.CreateEntry($File.Key, [IO.Compression.CompressionLevel]::Optimal)
            $InputStream = [IO.File]::OpenRead($File.Value)
            try {
                $OutputStream = $Entry.Open()
                try { $InputStream.CopyTo($OutputStream) }
                finally { $OutputStream.Dispose() }
            } finally { $InputStream.Dispose() }
        }
    } finally { $Zip.Dispose() }
    $FileStream.Flush($true)
} finally { $FileStream.Dispose() }

$FileStream = [IO.File]::OpenRead($ArchiveFile)
try {
    $Zip = [IO.Compression.ZipArchive]::new($FileStream, [IO.Compression.ZipArchiveMode]::Read, $true, [Text.Encoding]::UTF8)
    try {
        if ($Zip.Entries.Count -ne $Files.Count) { throw 'ZIP file count differs from the source.' }
        foreach ($Entry in $Zip.Entries) {
            $Source = $null
            if (!$Files.TryGetValue($Entry.FullName, [ref]$Source)) { throw "Unexpected ZIP entry: $($Entry.FullName)" }
            $EntryStream = $Entry.Open()
            try {
                if ((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash -ne
                    (Get-FileHash -InputStream $EntryStream -Algorithm SHA256).Hash) {
                    throw "ZIP verification failed: $($Entry.FullName)"
                }
            } finally { $EntryStream.Dispose() }
            [void]$Files.Remove($Entry.FullName)
        }
        if ($Files.Count) { throw 'Some source files are absent from the ZIP.' }
    } finally { $Zip.Dispose() }
} finally { $FileStream.Dispose() }
