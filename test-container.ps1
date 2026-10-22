param([switch]$KeepRunning)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$suffix = [guid]::NewGuid().ToString('N').Substring(0,12)
$testNetwork = "dashmood-test-$suffix"
$testVolume = "dashmood-test-pg-$suffix"
$testDb = "dashmood-test-db-$suffix"
$testApp = "dashmood-test-app-$suffix"
$testPassword = [guid]::NewGuid().ToString('N')
$testBase = 'http://127.0.0.1:18080'
$succeeded = $false
function Assert-Docker { if ($LASTEXITCODE -ne 0) { throw 'Docker operation failed' } }
function Start-TestDatabase {
  docker run -d --name $testDb --network $testNetwork --label dashmood.role=isolated-test -e POSTGRES_DB=dashmood_test -e POSTGRES_USER=dashmood_test -e "POSTGRES_PASSWORD=$testPassword" -v "${testVolume}:/var/lib/postgresql/data" postgres:16 | Out-Null
  Assert-Docker
  for($attempt=0;$attempt -lt 40;$attempt++) {
    docker exec $testDb pg_isready -U dashmood_test -d dashmood_test 2>$null | Out-Null
    if($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Milliseconds 500
  }
  throw 'Test PostgreSQL did not become ready'
}
function Start-TestApplication {
  docker run -d --name $testApp --network $testNetwork --label dashmood.role=isolated-test -p 127.0.0.1:18080:8080 -e "DATABASE_URL=postgres://dashmood_test:${testPassword}@${testDb}:5432/dashmood_test" -e "API_BASE_URL=$testBase" -e ALLOWED_ORIGIN=http://127.0.0.1:18081 dashmood:0.1.0 | Out-Null
  Assert-Docker
  for($attempt=0;$attempt -lt 30;$attempt++) {
    try { $health=Invoke-RestMethod "$testBase/health"; if($health.status -eq 'ok') { return } } catch {}
    Start-Sleep -Milliseconds 500
  }
  docker logs $testApp
  throw 'Test application did not become ready'
}
try {
  docker network create --label dashmood.role=isolated-test $testNetwork | Out-Null
  Assert-Docker
  docker volume create --label dashmood.role=isolated-test $testVolume | Out-Null
  Assert-Docker
  Start-TestDatabase
  Start-TestApplication
  node tests/integration.mjs $testBase initial
  if($LASTEXITCODE -ne 0) { throw 'Initial integration checks failed' }
  docker stop $testDb | Out-Null
  Assert-Docker
  node tests/integration.mjs $testBase unavailable
  if($LASTEXITCODE -ne 0) { throw 'Database outage check failed' }
  docker rm -f $testApp $testDb | Out-Null
  Assert-Docker
  Start-TestDatabase
  Start-TestApplication
  node tests/integration.mjs $testBase persisted
  if($LASTEXITCODE -ne 0) { throw 'Persistence check failed' }
  docker exec $testApp node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
  Assert-Docker
  $succeeded=$true
  if($KeepRunning) {
    @{app=$testApp;db=$testDb;volume=$testVolume;network=$testNetwork;base=$testBase} | ConvertTo-Json | Set-Content artifacts/test-session.json -Encoding utf8
    Write-Output "Isolated synthetic test environment: $testBase"
  }
} finally {
  if(-not ($KeepRunning -and $succeeded)) {
    docker rm -f $testApp $testDb 2>$null | Out-Null
    docker volume rm $testVolume 2>$null | Out-Null
    docker network rm $testNetwork 2>$null | Out-Null
  }
}
