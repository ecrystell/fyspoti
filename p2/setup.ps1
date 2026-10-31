$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$python = Get-Command py -ErrorAction SilentlyContinue
if ($python) {
    & py -3 -m venv p2/.venv
} else {
    & python -m venv p2/.venv
}
if ($LASTEXITCODE -ne 0) { throw 'Could not create the P2 Python environment' }
& 'p2/.venv/Scripts/python.exe' -m pip install --use-feature=truststore -r p2/worker/requirements-youtube.txt
if ($LASTEXITCODE -ne 0) { throw 'Could not install P2 source dependencies' }
