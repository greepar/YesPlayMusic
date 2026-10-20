const WINDOWS_PORTABLE_INSTALL_SCRIPT = String.raw`param(
  [int]$ParentPid,
  [string]$Target,
  [string]$Staged,
  [string]$Backup,
  [string]$Digest,
  [string]$Log
)
# A launcher can inherit PowerShell 7's module path. Resolve cmdlets from the
# helper's own PowerShell installation, including on Windows PowerShell 5.1.
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
$ErrorActionPreference = 'Stop'
function Write-UpdateLog([string]$Message) {
  try { Add-Content -LiteralPath $Log -Value $Message } catch {}
}
function Show-UpdateFailure {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('自动更新未完成，旧版本已保留。请检查程序目录的写入权限后重试。', 'YesPlayMusic 更新') | Out-Null
  } catch {}
}
function Move-WithRetry([string]$Source, [string]$Destination) {
  # The portable NSIS launcher may still hold the original EXE after Electron
  # exits. Retry the atomic rename until the launcher releases its file handle.
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ($true) {
    try { [IO.File]::Move($Source, $Destination); return }
    catch {
      Write-UpdateLog 'Waiting for portable launcher file lock'
      if ([DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 500
    }
  }
}
$oldMoved = $false
$newMoved = $false
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(120)
  while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
    if ([DateTime]::UtcNow -ge $deadline) { throw 'Application did not quit' }
    Start-Sleep -Milliseconds 500
  }
  if (!(Test-Path -LiteralPath $Target -PathType Leaf) -or
      !(Test-Path -LiteralPath $Staged -PathType Leaf) -or
      (Test-Path -LiteralPath $Backup)) { throw 'Application paths changed' }
  # Use .NET directly: a parent PowerShell 7 process can leave PSModulePath
  # without Windows PowerShell's utility module (which provides Get-FileHash).
  $hasher = [Security.Cryptography.SHA256]::Create()
  $stream = [IO.File]::OpenRead($Staged)
  try {
    $actualDigest = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '')
  } finally {
    $stream.Dispose()
    $hasher.Dispose()
  }
  if ($actualDigest -ne $Digest) {
    throw 'Staged update SHA-256 mismatch'
  }
  Move-WithRetry $Target $Backup
  $oldMoved = $true
  Move-WithRetry $Staged $Target
  $newMoved = $true
  Start-Process -FilePath $Target -WorkingDirectory ([IO.Path]::GetDirectoryName($Target)) -ErrorAction Stop | Out-Null
  try {
    [IO.File]::WriteAllText((Join-Path ([IO.Path]::GetDirectoryName($Backup)) 'launch-succeeded'), '')
  } catch { Write-UpdateLog 'Launch succeeded; cleanup marker could not be written' }
  Write-UpdateLog 'Update installed and launch requested; backup retained until startup completes'
  exit 0
} catch {
  Write-UpdateLog ('Update failed: ' + $_.Exception.Message)
  try {
    if ($newMoved) { Move-WithRetry $Target $Staged }
    if ($oldMoved) { Move-WithRetry $Backup $Target }
    if (Test-Path -LiteralPath $Target -PathType Leaf) {
      Start-Process -FilePath $Target -WorkingDirectory ([IO.Path]::GetDirectoryName($Target)) -ErrorAction Stop | Out-Null
    }
  } catch { Write-UpdateLog ('Rollback/relaunch failed: ' + $_.Exception.Message) }
  Show-UpdateFailure
  exit 1
}
`;

module.exports = { WINDOWS_PORTABLE_INSTALL_SCRIPT };
