#!/usr/bin/env bash
# Configura un MongoDB instalado en Linux o macOS como replica set de un nodo "rs0" (tarea 1.3).
# Uso: sudo ./scripts/mongo-local-replica.sh [ruta de mongod.conf]  (por defecto /etc/mongod.conf;
# en macOS con Homebrew: /opt/homebrew/etc/mongod.conf). Reinicia el servicio y ejecuta mongo/iniciar-replica.js.
set -euo pipefail
cd "$(dirname "$0")/.."
cfg=${1:-/etc/mongod.conf}
[ -f "$cfg" ] || { echo "No existe $cfg" >&2; exit 1; }

if grep -Eq '^\s*replSetName:\s*rs0' "$cfg"; then
  echo "mongod.conf ya tiene replSetName: rs0 ($cfg)"
else
  grep -Eq '^\s*replSetName:' "$cfg" && { echo "mongod.conf ya tiene otro replSetName; revísalo a mano: $cfg" >&2; exit 1; }
  cp "$cfg" "$cfg.bak"
  sed -i.tmp '/^#replication:\s*$/d' "$cfg" && rm -f "$cfg.tmp"
  printf '\nreplication:\n  replSetName: rs0\n' >> "$cfg"
  echo "Agregado replSetName: rs0 a $cfg (copia en $cfg.bak). Reiniciando MongoDB..."
  if command -v systemctl >/dev/null; then systemctl restart mongod; else brew services restart mongodb-community; fi
  sleep 3
fi

if command -v mongosh >/dev/null; then
  mongosh --quiet 'mongodb://localhost:27017/?directConnection=true' mongo/iniciar-replica.js
else
  driver=../services/materiales/node_modules/mongodb
  [ -d "$driver" ] || { echo "No hay mongosh ni services/materiales/node_modules." >&2; exit 1; }
  MONGO_DRIVER=$(cd "$driver" && pwd) node scripts/mongo-local-replica.mjs
fi
echo 'MongoDB local listo como replica set rs0. URI: mongodb://localhost:27017/materiales_db?replicaSet=rs0'
