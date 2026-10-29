# Conecta el celular Android a la computadora para probar la app: con `adb reverse`, el celular usa
# localhost:8080 (Keycloak), :8081 (Obras), :8082 (Materiales) y :8090 (Metro, servidor de Expo).
# Así el token sale con el mismo emisor (http://localhost:8080/realms/supervision) que validan los servicios.
# Requisitos: depuración USB activada (o depuración inalámbrica emparejada con `adb pair`) y el celular en `adb devices`.
# Repetir cada vez que se reconecta el celular.
if (-not (Get-Command adb -ErrorAction SilentlyContinue)) { Write-Error 'Falta adb (Android SDK platform-tools).'; exit 1 }
$dispositivos = @(adb devices | Select-Object -Skip 1 | Where-Object { $_ -match "\tdevice$" })
if ($dispositivos.Count -eq 0) {
    Write-Error 'No hay ningún celular conectado. Activa la depuración USB, conecta el cable y acepta el aviso en el celular.'
    exit 1
}
foreach ($puerto in 8080, 8081, 8082, 8090) {
    adb reverse "tcp:$puerto" "tcp:$puerto" | Out-Null
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
Write-Host 'Listo. Puertos enviados al celular:'
adb reverse --list
Write-Host 'Ahora en mobile/app-obra: npm start (Metro en el 8090) y abre la app en Expo Go.'
