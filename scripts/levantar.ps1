# Levanta el entorno y espera a que todo esté sano. Uso: ./scripts/levantar.ps1 [-Perfil bases[,otro]]
# No usa "up --wait" porque toma como fallo a los contenedores que corren una vez y terminan (rabbitmq-usuarios, mongo-init).
param([string[]]$Perfil = @())
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path .env)) { Write-Error 'Falta .env: copia .env.example a .env y completa las contraseñas.'; exit 1 }

$argumentos = @()
foreach ($p in $Perfil) { if ($p) { $argumentos += @('--profile', $p) } }
docker compose @argumentos up -d
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$limite = (Get-Date).AddMinutes(5)
while ($true) {
    $pendientes = 0
    $lineas = docker compose @argumentos ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}'
    foreach ($linea in $lineas) {
        $servicio, $estado, $salud, $salida = $linea.Split('|')
        if ($estado -eq 'exited') {
            if ($salida -ne '0') {
                Write-Host "$servicio terminó con error ($salida):"
                docker compose logs --tail 30 $servicio
                exit 1
            }
        } elseif ($estado -ne 'running' -or ($salud -and $salud -ne 'healthy')) {
            $pendientes++
        }
    }
    if ($pendientes -eq 0) { break }
    if ((Get-Date) -gt $limite) {
        Write-Host 'Pasaron 5 minutos y no todo está sano:'
        docker compose @argumentos ps -a
        exit 1
    }
    Start-Sleep -Seconds 3
}
Write-Host 'Entorno listo. Estado: ./scripts/estado.ps1'
