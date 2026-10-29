#!/usr/bin/env bash
# Conecta el celular Android a la computadora para probar la app: con `adb reverse`, el celular usa
# localhost:8080 (Keycloak), :8081 (Obras), :8082 (Materiales) y :8090 (Metro, servidor de Expo).
# Así el token sale con el mismo emisor (http://localhost:8080/realms/supervision) que validan los servicios.
# Requisitos: depuración USB activada (o depuración inalámbrica emparejada con `adb pair`) y el celular en `adb devices`.
# Repetir cada vez que se reconecta el celular.
set -euo pipefail
command -v adb >/dev/null || { echo "Falta adb (Android SDK platform-tools)." >&2; exit 1; }
dispositivos=$(adb devices | awk 'NR>1 && $2=="device"' | wc -l)
if [ "$dispositivos" -eq 0 ]; then
  echo "No hay ningún celular conectado. Activa la depuración USB, conecta el cable y acepta el aviso en el celular." >&2
  exit 1
fi
for puerto in 8080 8081 8082 8090; do
  adb reverse tcp:$puerto tcp:$puerto >/dev/null
done
echo "Listo. Puertos enviados al celular:"
adb reverse --list
echo "Ahora en mobile/app-obra: npm start (Metro en el 8090) y abre la app en Expo Go."
