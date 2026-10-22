$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop with Linux containers first.' }
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
docker build --platform linux/amd64 -t dashmood:0.1.0 .
if ($LASTEXITCODE -ne 0) { throw 'Image build failed' }
& "$PSScriptRoot/test-container.ps1"
if (-not $?) { throw 'Container integration checks failed' }
New-Item -ItemType Directory -Force artifacts | Out-Null
docker save -o artifacts/dashmood-0.1.0-linux-amd64.tar dashmood:0.1.0
if ($LASTEXITCODE -ne 0) { throw 'Image export failed' }
$archiveHash = (Get-FileHash artifacts/dashmood-0.1.0-linux-amd64.tar -Algorithm SHA256).Hash.ToLowerInvariant()
"$archiveHash  dashmood-0.1.0-linux-amd64.tar" | Set-Content artifacts/dashmood-0.1.0-linux-amd64.tar.sha256 -Encoding ascii
docker load -i artifacts/dashmood-0.1.0-linux-amd64.tar
if ($LASTEXITCODE -ne 0) { throw 'Archive load verification failed' }
