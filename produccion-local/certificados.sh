#!/usr/bin/env bash
# 601 · Genera la CA local del ensayo y el certificado de RabbitMQ en produccion-local/certificados/ (fuera del repo),
# con OpenSSL dentro de un contenedor (openssl/generar.sh; no hace falta instalar nada). Idempotente.
# Uso: ./produccion-local/certificados.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$DIR/certificados"
# En Git Bash, docker necesita la ruta de Windows y que no se conviertan las rutas del contenedor
ruta() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint sh \
  -v "$(ruta "$DIR/certificados"):/certificados" \
  -v "$(ruta "$DIR/openssl/generar.sh"):/generar.sh:ro" \
  rabbitmq:4.4-management /generar.sh
