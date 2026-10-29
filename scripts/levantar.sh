#!/usr/bin/env bash
# Levanta el entorno y espera a que todo esté sano. Uso: ./scripts/levantar.sh [--perfil bases] [--perfil otro]
# No usa "up --wait" porque toma como fallo a los contenedores que corren una vez y terminan (rabbitmq-init, mongo-init).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Falta .env: copia .env.example a .env y completa las contraseñas." >&2; exit 1; }

perfiles=()
while [ $# -gt 0 ]; do
  case "$1" in
    --perfil) perfiles+=(--profile "$2"); shift 2 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done

docker compose "${perfiles[@]}" up -d

limite=$((SECONDS + 300))
while true; do
  pendientes=0
  while IFS='|' read -r servicio estado salud salida; do
    if [ "$estado" = exited ]; then
      if [ "$salida" != 0 ]; then
        echo "$servicio terminó con error ($salida):" >&2
        docker compose logs --tail 30 "$servicio" >&2
        exit 1
      fi
    elif [ "$estado" != running ] || { [ -n "$salud" ] && [ "$salud" != healthy ]; }; then
      pendientes=$((pendientes + 1))
    fi
  done < <(docker compose "${perfiles[@]}" ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}')
  [ "$pendientes" -eq 0 ] && break
  if [ $SECONDS -ge $limite ]; then
    echo "Pasaron 5 minutos y no todo está sano:" >&2
    docker compose "${perfiles[@]}" ps -a >&2
    exit 1
  fi
  sleep 3
done
echo "Entorno listo. Estado: ./scripts/estado.sh"
