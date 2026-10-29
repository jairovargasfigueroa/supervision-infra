#!/usr/bin/env bash
# Borra los volúmenes (RabbitMQ, Keycloak y, con el perfil bases, PostgreSQL y MongoDB) y vuelve a levantar todo vacío.
# Uso: ./scripts/reiniciar-datos.sh [--si] [--perfil bases]
set -euo pipefail
cd "$(dirname "$0")/.."
confirmado=no
argumentos=()
while [ $# -gt 0 ]; do
  case "$1" in
    --si) confirmado=si; shift ;;
    --perfil) argumentos+=(--perfil "$2"); shift 2 ;;
    *) echo "Opción desconocida: $1" >&2; exit 1 ;;
  esac
done
if [ "$confirmado" != si ]; then
  read -r -p "Esto borra los datos de RabbitMQ, Keycloak y de las bases en contenedor. ¿Continuar? (s/N) " respuesta
  [ "$respuesta" = s ] || [ "$respuesta" = S ] || { echo "Cancelado."; exit 0; }
fi
docker compose --profile '*' down --volumes
./scripts/levantar.sh "${argumentos[@]}"
