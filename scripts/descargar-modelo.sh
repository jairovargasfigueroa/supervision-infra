#!/usr/bin/env bash
# 503 · Descarga el modelo de lenguaje en el servicio ollama (volumen datos-ollama). Uso: ./scripts/descargar-modelo.sh [modelo]
# Sin modelo usa IA_LLM_MODELO de .env y, si está vacío, qwen3:8b (unos 5 GB; la primera vez tarda). Correrlo otra vez
# solo baja lo que cambió. Si ollama no está corriendo, lo levanta (con la GPU si .env tiene COMPOSE_FILE con docker-compose.gpu.yml).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Falta .env: copia .env.example a .env y completa las contraseñas." >&2; exit 1; }

modelo="${1:-}"
if [ -z "$modelo" ]; then
  modelo="$(grep -E '^[[:space:]]*IA_LLM_MODELO[[:space:]]*=' .env | tail -n 1 | cut -d= -f2- | tr -d "\"' \r" || true)"
fi
modelo="${modelo:-qwen3:8b}"
[[ "$modelo" =~ ^[A-Za-z0-9._/:-]+$ ]] || { echo "Nombre de modelo no válido: $modelo" >&2; exit 1; }

if [ -z "$(docker compose --profile ollama ps --status running -q ollama)" ]; then
  echo 'Levantando el servicio ollama...'
  docker compose --profile ollama up -d ollama
  limite=$((SECONDS + 120))
  until [ "$(docker compose --profile ollama ps --format '{{.Health}}' ollama)" = healthy ]; do
    if [ $SECONDS -gt $limite ]; then
      echo 'ollama no quedó sano en 2 minutos.' >&2
      docker compose logs --tail 30 ollama >&2
      exit 1
    fi
    sleep 2
  done
fi

echo "Descargando $modelo en ollama (volumen datos-ollama)..."
docker compose --profile ollama exec ollama ollama pull "$modelo"
docker compose --profile ollama exec ollama ollama list
