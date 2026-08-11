param(
  [switch]$Restart,
  [ValidateSet("Maven", "Jar")]
  [string]$BackendMode = "Maven"
)

$rootScript = Join-Path $PSScriptRoot "..\start-youmi.ps1"
if (-not (Test-Path $rootScript -PathType Leaf)) {
  throw "Unified startup script was not found: $rootScript"
}

if ($BackendMode -ne "Maven") {
  Write-Warning "BackendMode is retained for compatibility; the unified development launcher uses Maven."
}

& $rootScript -Restart:$Restart
exit $LASTEXITCODE
