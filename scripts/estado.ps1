# Muestra qué contenedor está sano y llama GET /salud de cada servicio que esté corriendo.
Set-Location (Split-Path -Parent $PSScriptRoot)
docker compose --profile '*' ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
Write-Host ''
$servicios = [ordered]@{
    Obras      = 'http://localhost:8081/salud'
    Materiales = 'http://localhost:8082/salud'
    Finanzas   = 'http://localhost:8083/salud'
    Sincronizacion = 'http://localhost:8084/salud'
    IA         = 'http://localhost:8085/salud'
}
foreach ($nombre in $servicios.Keys) {
    try {
        $r = Invoke-RestMethod -Uri $servicios[$nombre] -TimeoutSec 3
        if ($r.estado -eq 'ok') { Write-Host "${nombre}: sano" } else { Write-Host "${nombre}: responde sin estado ok" }
    } catch { Write-Host "${nombre}: no responde ($($servicios[$nombre]))" }
}
try {
    $r = Invoke-RestMethod -Uri 'http://localhost:4000/graphql' -Method Post -ContentType 'application/json' -Body '{"query":"{ salud }"}' -TimeoutSec 3
    if ($null -ne $r.data.salud) { Write-Host 'Gateway: sano' } else { Write-Host 'Gateway: responde sin salud' }
} catch { Write-Host 'Gateway: no responde (http://localhost:4000/graphql)' }
# 503 · Ollama (perfil ollama): versión y modelos descargados
try {
    $v = Invoke-RestMethod -Uri "http://localhost:11434/api/version" -TimeoutSec 3
    $modelos = ((Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 3).models | ForEach-Object { $_.name }) -join ", "
    if (-not $modelos) { $modelos = "ninguno, corre scripts/descargar-modelo.ps1" }
    Write-Host "Ollama: responde (version $($v.version); modelos: $modelos)"
} catch { Write-Host "Ollama: no responde (http://localhost:11434; perfil ollama)" }
# 201 · Cobranza automática (perfil automatizacion): n8n y Mailpit
try {
    Invoke-RestMethod -Uri 'http://localhost:5678/healthz/readiness' -TimeoutSec 3 | Out-Null
    Write-Host 'n8n: sano (http://localhost:5678)'
} catch { Write-Host 'n8n: no responde (http://localhost:5678; perfil automatizacion)' }
try {
    $m = Invoke-RestMethod -Uri 'http://localhost:8025/api/v1/info' -TimeoutSec 3
    Write-Host "Mailpit: responde ($($m.Messages) correos; http://localhost:8025)"
} catch { Write-Host 'Mailpit: no responde (http://localhost:8025; perfil automatizacion)' }
