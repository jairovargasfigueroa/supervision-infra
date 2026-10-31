# Vacía los datos de desarrollo y vuelve a cargar los datos de prueba (011) con la fecha del día.
# Vacía Finanzas y Materiales con sus comandos, las colas de la plataforma en RabbitMQ, la base de reportes de IA
# (401) y las fotos del bucket (prefijo fotos/); reimporta el realm si los usuarios no tienen su id; carga con Obras
# en modo recargar (Obras vacía sus tablas en la misma transacción en que carga) y pide correr la carga inicial de
# la base de reportes. Se recomienda detener antes los servicios.
# Uso: ./semilla/recargar.ps1 [-Si]     (-Si omite la confirmación)
param([switch]$Si)
. (Join-Path $PSScriptRoot 'comun.ps1')

$config = Comprobar-Entorno -ConRabbitMQ
& node $Ayudante servicios 2>&1 | ForEach-Object { Write-Host (Linea $_) -ForegroundColor Yellow }

if (-not $Si) {
    $bucket = ''
    if ($config.Fotos) { $bucket = " y las fotos de s3://$($config.Bucket)/fotos/" }
    Write-Host ''
    $respuesta = Read-Host "Esto borra todos los datos de desarrollo de obras_db, finanzas_db, materiales_db, reportes_db, las colas de RabbitMQ de la plataforma$bucket. ¿Continuar? (s/N)"
    if ($respuesta -ne 's' -and $respuesta -ne 'S') { Write-Host 'Cancelado: no se borró nada.'; exit 0 }
}

Paso 'Vaciar Finanzas (datos-prueba:vaciar)'
Ejecutar 'Finanzas' $config.Finanzas 'php' @('artisan', 'datos-prueba:vaciar') | Out-Null

Paso 'Vaciar Materiales (npm run semilla:vaciar)'
Ejecutar 'Materiales' $config.Materiales 'npm.cmd' @('run', 'semilla:vaciar') | Out-Null

Paso 'Vaciar las colas de la plataforma (RabbitMQ)'
& node $Ayudante colas 2>&1 | ForEach-Object { Write-Host (Linea $_) }
if ($LASTEXITCODE -ne 0) { exit 1 }

Paso 'Vaciar la base de reportes de IA (reportes_db, 401)'
$reportesVacia = Vaciar-Reportes

Paso 'Borrar las fotos del bucket S3 de desarrollo'
if ($config.Fotos) {
    Ejecutar-S3 @('s3', 'rm', "s3://$($config.Bucket)/fotos/", '--recursive', '--only-show-errors') | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { Detener "No se pudieron borrar las fotos de s3://$($config.Bucket)/fotos/ (salida de arriba)." }
    Write-Host "ok       s3://$($config.Bucket)/fotos/ vacío"
} else {
    Aviso 'Fotos saltadas (sin bucket o sin claves en infra/.env).'
}

Paso 'Keycloak: usuarios con su id fijo'
$codigo = Verificar-Usuarios
if ($codigo -eq 3) {
    Write-Host 'Se reimporta el realm (se recrea el contenedor de Keycloak; lo cambiado a mano en el panel se pierde).'
    Push-Location $Infra
    & docker compose up -d --force-recreate keycloak 2>&1 | ForEach-Object { Write-Host (Linea $_) }
    $codigoDocker = $LASTEXITCODE
    Pop-Location
    if ($codigoDocker -ne 0) { Detener 'No se pudo recrear Keycloak (salida de arriba).' }
    & node $Ayudante esperar-keycloak 2>&1 | ForEach-Object { Write-Host (Linea $_) }
    if ($LASTEXITCODE -ne 0) { exit 1 }
    $codigo = Verificar-Usuarios
}
if ($codigo -ne 0) { Detener 'Los usuarios de Keycloak siguen sin coincidir con docs/datos-prueba.md: revisa keycloak/realm-supervision.json.' }

Cargar-Datos $config 'recargar'

Paso 'Base de reportes (401): falta la carga inicial'
if ($reportesVacia) {
    Write-Host 'reportes_db quedó vacía. Con Obras, Materiales y Finanzas levantados, corre la carga inicial del servicio de IA:'
} else {
    Write-Host 'Cuando el servicio de IA tenga su base, con Obras, Materiales y Finanzas levantados, corre la carga inicial:'
}
Write-Host '  docker compose --profile ia-carga run --rm ia-carga-inicial     (en infra)'
Write-Host '  o, en services/ia: uv run python -m ia.carga_inicial'
