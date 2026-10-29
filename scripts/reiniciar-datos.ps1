# Borra los volúmenes (RabbitMQ, Keycloak y, con el perfil bases, PostgreSQL y MongoDB) y vuelve a levantar todo vacío.
# Uso: ./scripts/reiniciar-datos.ps1 [-Si] [-Perfil bases]
param([switch]$Si, [string[]]$Perfil = @())
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not $Si) {
    $respuesta = Read-Host 'Esto borra los datos de RabbitMQ, Keycloak y de las bases en contenedor. ¿Continuar? (s/N)'
    if ($respuesta -ne 's' -and $respuesta -ne 'S') { Write-Host 'Cancelado.'; exit 0 }
}
docker compose --profile '*' down --volumes --remove-orphans
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& (Join-Path $PSScriptRoot 'levantar.ps1') -Perfil $Perfil
