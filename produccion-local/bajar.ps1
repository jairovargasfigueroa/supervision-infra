# 601 · Baja la «producción local» (los tres grupos o uno). Conserva los datos salvo con -Datos, que borra los
# volúmenes de esos grupos (bases, colas, n8n, MinIO y los certificados de Caddy; nunca el modelo de Ollama de
# desarrollo, que es externo). No toca el entorno de desarrollo (proyecto «supervision»).
# Uso: ./produccion-local/bajar.ps1 [-Grupo azure|google|aws] [-Datos]
param([ValidateSet('azure', 'google', 'aws')][string]$Grupo, [switch]$Datos)
. (Join-Path $PSScriptRoot 'comun.ps1')

if (-not (Test-Path $RutaEnv)) { Detener 'Falta produccion-local/.env.' }
$grupos = if ($Grupo) { @($Grupo) } else { $Grupos[($Grupos.Count - 1)..0] }
foreach ($g in $grupos) {
    Paso "Grupo $g"
    $argumentos = @('--profile', '*', 'down', '--remove-orphans')
    if ($Datos) { $argumentos += '--volumes' }
    if ((Compose $g $argumentos) -ne 0) { Detener "No se pudo bajar el grupo $g (salida de arriba)." }
}
if ($Datos) { Write-Host 'Volúmenes borrados: al levantar, las bases empiezan vacías y Keycloak vuelve a importar el realm.' }
