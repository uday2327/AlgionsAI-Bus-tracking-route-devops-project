param([string]$HostName = "localhost")

$ErrorActionPreference = "Stop"
$sslDir = Join-Path $PSScriptRoot "..\nginx\ssl"
New-Item -ItemType Directory -Force -Path $sslDir | Out-Null
docker run --rm -v "${sslDir}:/certs" alpine/openssl req -x509 -nodes -days 365 -newkey rsa:2048 `
  -keyout /certs/server.key -out /certs/server.crt -subj "/CN=$HostName" `
  -addext "subjectAltName=DNS:$HostName,IP:127.0.0.1"
Write-Host "Created an untrusted local certificate in nginx/ssl. Do not use it for public production traffic."
