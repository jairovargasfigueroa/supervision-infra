# Detiene el entorno sin borrar los datos (los volúmenes se conservan).
Set-Location (Split-Path -Parent $PSScriptRoot)
docker compose --profile '*' down --remove-orphans
exit $LASTEXITCODE
