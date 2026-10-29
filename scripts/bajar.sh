#!/usr/bin/env bash
# Detiene el entorno sin borrar los datos (los volúmenes se conservan).
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose --profile '*' down
