param([switch]$BuildOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeRuntime = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $nodeRuntime) {
    $bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $bundledNode) { $nodeRuntime = $bundledNode }
}
if (-not $nodeRuntime) { throw 'Node.js was not found. Install Node.js LTS, reopen PowerShell, and run this launcher again.' }
if (-not (Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe')) { throw 'Electron runtime missing. Run npm install and npm run setup:desktop first.' }
Write-Host "Building Fyspoti using $nodeRuntime"
& $nodeRuntime 'node_modules/typescript/bin/tsc' -p tsconfig.frontend.json
if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed' }
& $nodeRuntime 'node_modules/vite/bin/vite.js' build
if ($LASTEXITCODE -ne 0) { throw 'Vite build failed' }
if (-not $BuildOnly) { & '.\node_modules\electron\dist\electron.exe' . }
