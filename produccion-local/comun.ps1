# 601 · Funciones comunes de levantar, bajar y publicar-frontends (PowerShell). Mismo comportamiento que comun.sh.
# Se carga con: . (Join-Path $PSScriptRoot 'comun.ps1')
$ErrorActionPreference = 'Continue'
$script:Dir = $PSScriptRoot
$script:Infra = Split-Path -Parent $PSScriptRoot
$script:RutaEnv = Join-Path $PSScriptRoot '.env'
# Orden de arranque: azure es el centro (Keycloak y RabbitMQ), después google y aws
$script:Grupos = @('azure', 'google', 'aws')

function Detener([string]$Mensaje) {
    Write-Host ''
    Write-Host "ERROR: $Mensaje" -ForegroundColor Red
    exit 1
}

function Paso([string]$Titulo) {
    Write-Host ''
    Write-Host "== $Titulo" -ForegroundColor Cyan
}

# Texto de una línea de salida (PowerShell 5.1 envuelve el stderr de los programas en ErrorRecord)
function Linea($Objeto) {
    if ($Objeto -is [System.Management.Automation.ErrorRecord]) { return $Objeto.Exception.Message }
    return "$Objeto"
}

# .env de esta carpeta como tabla (no se ejecuta: solo líneas NOMBRE=valor; quita comillas que envuelven el valor)
function Leer-Env {
    if (-not (Test-Path $RutaEnv)) { Detener "Falta produccion-local/.env: copia produccion-local/.env.example a .env y completa los valores." }
    $valores = @{}
    foreach ($linea in (Get-Content -Encoding UTF8 $RutaEnv)) {
        if ($linea -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
            $valor = $Matches[2].Trim()
            if ($valor.Length -ge 2 -and (($valor[0] -eq "'" -and $valor[-1] -eq "'") -or ($valor[0] -eq '"' -and $valor[-1] -eq '"'))) { $valor = $valor.Substring(1, $valor.Length - 2) }
            $valores[$Matches[1]] = $valor
        }
    }
    return $valores
}

# Ruta de una carpeta de proyecto del .env (relativa a esta carpeta)
function Carpeta([hashtable]$Env, [string]$Variable, [string]$PorDefecto) {
    $valor = $Env[$Variable]
    if (-not $valor) { $valor = $PorDefecto }
    if (-not [System.IO.Path]::IsPathRooted($valor)) { $valor = Join-Path $Dir $valor }
    return [System.IO.Path]::GetFullPath($valor)
}

# docker compose de un grupo, con el .env de esta carpeta
function Compose([string]$Grupo, [string[]]$Argumentos) {
    $todo = @('compose', '-f', (Join-Path $Dir "compose.$Grupo.yml"), '--env-file', $RutaEnv) + $Argumentos
    & docker @todo 2>&1 | ForEach-Object { Write-Host (Linea $_) }
    return $LASTEXITCODE
}

# Espera a que todos los contenedores del grupo estén corriendo (y sanos si tienen healthcheck) y a que los de una
# sola vez (rabbitmq-init, mongo-init, minio-init) terminen con 0. No usa "up --wait", que toma como fallo a los que
# terminan. Devuelve $true si quedó todo bien antes del límite.
function Esperar-Grupo([string]$Grupo, [int]$Segundos = 900) {
    $limite = (Get-Date).AddSeconds($Segundos)
    $archivo = Join-Path $Dir "compose.$Grupo.yml"
    while ((Get-Date) -lt $limite) {
        $filas = @(& docker compose -f $archivo --env-file $RutaEnv ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}' 2>$null)
        $pendientes = @()
        $fallidos = @()
        foreach ($fila in $filas) {
            $servicio, $estado, $salud, $codigo = "$fila".Split('|')
            if ($estado -eq 'exited') {
                if ($codigo -ne '0') { $fallidos += "$servicio (terminó con $codigo)" }
            } elseif ($estado -ne 'running' -or ($salud -and $salud -ne 'healthy')) {
                if ($salud -eq 'unhealthy') { $fallidos += "$servicio (unhealthy)" } else { $pendientes += $servicio }
            }
        }
        if ($fallidos.Count -gt 0) {
            Write-Host "Con problemas en ${Grupo}: $($fallidos -join ', '). Revisa: docker compose -f produccion-local/compose.$Grupo.yml logs <servicio>" -ForegroundColor Red
            return $false
        }
        if ($filas.Count -gt 0 -and $pendientes.Count -eq 0) { Write-Host "ok       grupo $Grupo sano"; return $true }
        Write-Host "esperando en ${Grupo}: $($pendientes -join ', ')"
        Start-Sleep -Seconds 10
    }
    Write-Host "El grupo $Grupo no quedó sano en $Segundos s: docker compose -f produccion-local/compose.$Grupo.yml ps" -ForegroundColor Red
    return $false
}
