# 601 · Genera la CA local del ensayo y el certificado de RabbitMQ en produccion-local/certificados/ (fuera del repo),
# con OpenSSL dentro de un contenedor (openssl/generar.sh; no hace falta instalar nada). Idempotente.
# Uso: ./produccion-local/certificados.ps1
$ErrorActionPreference = 'Continue'   # docker escribe en stderr sin que sea un error
$carpeta = Join-Path $PSScriptRoot 'certificados'
New-Item -ItemType Directory -Force $carpeta | Out-Null
& docker run --rm --entrypoint sh `
    -v "${carpeta}:/certificados" `
    -v "$(Join-Path $PSScriptRoot 'openssl\generar.sh'):/generar.sh:ro" `
    rabbitmq:4.4-management /generar.sh
if ($LASTEXITCODE -ne 0) { Write-Host 'ERROR: no se pudieron generar los certificados (salida de arriba).' -ForegroundColor Red; exit 1 }
exit 0
