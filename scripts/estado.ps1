# Muestra qué contenedor está sano y llama GET /salud de cada servicio que esté corriendo.
Set-Location (Split-Path -Parent $PSScriptRoot)
docker compose --profile '*' ps -a --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
Write-Host ''
$servicios = [ordered]@{
    Obras      = 'http://localhost:8081/salud'
    Materiales = 'http://localhost:8082/salud'
    Finanzas   = 'http://localhost:8083/salud'
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
