# 503 · Descarga el modelo de lenguaje en el servicio ollama (volumen datos-ollama). Uso: ./scripts/descargar-modelo.ps1 [-Modelo qwen3:8b]
# Sin -Modelo usa IA_LLM_MODELO de .env y, si está vacío, qwen3:8b (unos 5 GB; la primera vez tarda). Correrlo otra vez
# solo baja lo que cambió. Si ollama no está corriendo, lo levanta (con la GPU si .env tiene COMPOSE_FILE con docker-compose.gpu.yml).
param([string]$Modelo = '')
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path .env)) { Write-Error 'Falta .env: copia .env.example a .env y completa las contraseñas.'; exit 1 }

if (-not $Modelo) {
    $linea = Get-Content .env | Where-Object { $_ -match '^\s*IA_LLM_MODELO\s*=' } | Select-Object -Last 1
    if ($linea) { $Modelo = ($linea -split '=', 2)[1].Trim().Trim('"').Trim("'") }
}
if (-not $Modelo) { $Modelo = 'qwen3:8b' }
if ($Modelo -notmatch '^[A-Za-z0-9._/:-]+$') { Write-Error "Nombre de modelo no válido: $Modelo"; exit 1 }

$corriendo = docker compose --profile ollama ps --status running -q ollama
if (-not $corriendo) {
    Write-Host 'Levantando el servicio ollama...'
    docker compose --profile ollama up -d ollama
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $limite = (Get-Date).AddMinutes(2)
    while ((docker compose --profile ollama ps --format '{{.Health}}' ollama) -ne 'healthy') {
        if ((Get-Date) -gt $limite) { Write-Error 'ollama no quedó sano en 2 minutos.'; docker compose logs --tail 30 ollama; exit 1 }
        Start-Sleep -Seconds 2
    }
}

Write-Host "Descargando $Modelo en ollama (volumen datos-ollama)..."
docker compose --profile ollama exec ollama ollama pull $Modelo
if ($LASTEXITCODE -ne 0) { Write-Error "No se pudo descargar $Modelo."; exit $LASTEXITCODE }
docker compose --profile ollama exec ollama ollama list
