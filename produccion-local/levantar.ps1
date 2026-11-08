# 601 · Levanta la «producción local»: los tres grupos (azure, google, aws) con las imágenes de producción y los
# frontends compilados, HTTPS con la CA local y RabbitMQ por TLS, y termina con los datos de demostración y la carga
# inicial de la base de reportes. No toca el entorno de desarrollo (proyecto «supervision»).
# Uso: ./produccion-local/levantar.ps1 [-Grupo azure|google|aws] [-DesdeGhcr] [-SinCompilar] [-SinFrontends]
#                                      [-SinDatos] [-ConOllama]
#   -Grupo        solo ese grupo (si la laptop no alcanza para los tres: primero azure, el centro). Sin los tres
#                 arriba no se cargan los datos: después, ./semilla/semilla.ps1 -Entorno produccion-local/.env
#   -DesdeGhcr    descarga las imágenes publicadas por GitHub Actions (etiqueta main) en lugar de construirlas
#   -SinCompilar  publica los frontends con la carpeta compilada que ya tienen (publicar-frontends -SinCompilar)
#   -SinFrontends no vuelve a publicar los frontends (quedan los de la última vez)
#   -SinDatos     no carga los datos de demostración ni corre la carga inicial
#   -ConOllama    también el modelo de lenguaje local en el grupo google (perfil ollama; reusa el modelo descargado)
param(
    [ValidateSet('azure', 'google', 'aws')][string]$Grupo,
    [switch]$DesdeGhcr, [switch]$SinCompilar, [switch]$SinFrontends, [switch]$SinDatos, [switch]$ConOllama
)
. (Join-Path $PSScriptRoot 'comun.ps1')

$envPl = Leer-Env
$grupos = if ($Grupo) { @($Grupo) } else { $Grupos }
& docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) { Detener 'Docker no responde: abre Docker Desktop.' }

Paso 'Certificados (CA local y RabbitMQ)'
& (Join-Path $Dir 'certificados.ps1')
if ($LASTEXITCODE -ne 0) { exit 1 }

if ($DesdeGhcr) {
    # La variable del proceso manda sobre la del .env en docker compose
    $env:IMAGEN_ETIQUETA = 'main'
    Paso 'Imágenes publicadas en GHCR (etiqueta main)'
    foreach ($g in $grupos) {
        if ((Compose $g @('pull', '--ignore-pull-failures')) -ne 0) { Detener "No se pudieron descargar las imágenes del grupo $g." }
    }
} else {
    Paso 'Imágenes de producción (se construyen desde las carpetas de los proyectos)'
    foreach ($g in $grupos) {
        if ((Compose $g @('build')) -ne 0) { Detener "No se pudieron construir las imágenes del grupo $g (salida de arriba)." }
    }
}

if (($grupos -contains 'azure') -and -not $SinFrontends) {
    Paso 'Frontends compilados'
    # Con una tabla (no un arreglo): un '-SinCompilar' en un arreglo llega como texto posicional (a -Solo)
    $argumentos = @{}
    if ($SinCompilar) { $argumentos['SinCompilar'] = $true }
    & (Join-Path $Dir 'publicar-frontends.ps1') @argumentos
    if ($LASTEXITCODE -ne 0) { exit 1 }
}
New-Item -ItemType Directory -Force (Join-Path $Dir 'sitios') | Out-Null

foreach ($g in $grupos) {
    Paso "Grupo $g"
    $argumentos = @()
    if ($g -eq 'google' -and $ConOllama) { $argumentos += @('--profile', 'ollama') }
    if ((Compose $g ($argumentos + @('up', '-d', '--no-build'))) -ne 0) { Detener "No se pudo levantar el grupo $g (salida de arriba)." }
    if (-not (Esperar-Grupo $g)) { Detener "El grupo $g no quedó sano." }
}

if (-not $SinDatos) {
    if ($Grupo) {
        Write-Host ''
        Write-Host 'Datos de demostración: cuando estén los tres grupos, ./semilla/semilla.ps1 -Entorno produccion-local/.env y'
        Write-Host '  docker compose -f produccion-local/compose.google.yml --env-file produccion-local/.env run --rm ia-carga-inicial'
    } else {
        Paso 'Datos de demostración (semilla con SEMILLA_DEMO=si)'
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Infra 'semilla\semilla.ps1') -Entorno $RutaEnv
        if ($LASTEXITCODE -ne 0) { Detener 'La semilla de demostración falló (salida de arriba).' }
        Paso 'Carga inicial de la base de reportes (401)'
        if ((Compose 'google' @('run', '--rm', '--no-TTY', 'ia-carga-inicial')) -ne 0) { Detener 'La carga inicial de reportes falló (salida de arriba).' }
    }
}

Paso 'Listo'
foreach ($par in @(
        @('ERP', 'ERP_URL'), @('Portal', 'PORTAL_URL'), @('Keycloak', 'KEYCLOAK_URL'), @('Gateway', 'GATEWAY_URL'),
        @('Mailpit', 'MAILPIT_URL'), @('n8n', 'N8N_URL'), @('RabbitMQ (panel)', 'RABBITMQ_PANEL_URL'),
        @('IA', 'IA_URL'), @('Materiales', 'MATERIALES_URL'), @('Sincronización', 'SINCRONIZACION_URL'))) {
    Write-Host ('{0,-18} {1}' -f $par[0], $envPl[$par[1]])
}
Write-Host ''
Write-Host "El navegador avisa una vez por dirección que el certificado no es de confianza (CA local: produccion-local/certificados/ca.crt; README, «Producción local»)."
Write-Host 'Prueba de humo: node pruebas/humo-despliegue.mjs --entorno produccion-local/.env [--completa]'
