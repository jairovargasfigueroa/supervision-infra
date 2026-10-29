# Configura el MongoDB instalado en Windows como replica set de un nodo "rs0" (tarea 1.3).
# Ejecutar UNA vez en una terminal de PowerShell abierta como administrador: ./scripts/mongo-local-replica.ps1
# Agrega "replication.replSetName: rs0" al mongod.cfg del servicio (guarda una copia .bak), reinicia el servicio
# y ejecuta mongo/iniciar-replica.js con mongosh o, si no está, con el driver de services/materiales.
# Se puede ejecutar varias veces.
param([string]$Servicio = 'MongoDB')
$ErrorActionPreference = 'Stop'
$infra = Split-Path -Parent $PSScriptRoot

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Error 'Abre PowerShell como administrador: hay que editar mongod.cfg y reiniciar el servicio.'; exit 1 }

$ruta = (Get-CimInstance Win32_Service -Filter "Name='$Servicio'").PathName
if (-not $ruta) { Write-Error "No existe el servicio de Windows '$Servicio'."; exit 1 }
if ($ruta -notmatch '--config\s+"?([^"]+\.cfg)"?') { Write-Error "El servicio no usa --config: $ruta"; exit 1 }
$cfg = $Matches[1]

$contenido = Get-Content $cfg -Raw
if ($contenido -match '(?m)^\s*replSetName:\s*rs0') {
    Write-Host "mongod.cfg ya tiene replSetName: rs0 ($cfg)"
} else {
    if ($contenido -match '(?m)^\s*replSetName:') { Write-Error "mongod.cfg ya tiene otro replSetName; revísalo a mano: $cfg"; exit 1 }
    Copy-Item $cfg "$cfg.bak" -Force
    $contenido = $contenido -replace '(?m)^#replication:\s*$', ''
    $contenido = $contenido.TrimEnd() + "`r`n`r`nreplication:`r`n  replSetName: rs0`r`n"
    [System.IO.File]::WriteAllText($cfg, $contenido, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Agregado replSetName: rs0 a $cfg (copia en $cfg.bak). Reiniciando $Servicio..."
    Restart-Service $Servicio
    Start-Sleep -Seconds 3
}

$script = Join-Path $infra 'mongo\iniciar-replica.js'
$mongosh = Get-Command mongosh -ErrorAction SilentlyContinue
if ($mongosh) {
    & $mongosh.Source --quiet 'mongodb://localhost:27017/?directConnection=true' $script
} else {
    # Sin mongosh: el mismo procedimiento con el driver de Node que ya instaló services/materiales
    $driver = Join-Path $infra '..\services\materiales\node_modules\mongodb'
    if (-not (Test-Path $driver)) { Write-Error 'No hay mongosh ni services/materiales/node_modules. Instala mongosh (winget install MongoDB.Shell) o ejecuta npm install en services/materiales.'; exit 1 }
    $env:MONGO_DRIVER = (Resolve-Path $driver).Path
    node (Join-Path $PSScriptRoot 'mongo-local-replica.mjs')
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'MongoDB local listo como replica set rs0. URI: mongodb://localhost:27017/materiales_db?replicaSet=rs0'
