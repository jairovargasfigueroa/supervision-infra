#!/bin/bash
# 601 · PostgreSQL del grupo azure (como el PostgreSQL administrado de la 602): un usuario por servicio, dueño de su
# base (obras_db, finanzas_db y keycloak_db), con las contraseñas del .env de produccion-local. Corre solo con el
# volumen vacío. Las contraseñas van como variables de psql para no armar SQL a mano.
set -euo pipefail

for variable in POSTGRES_OBRAS_CLAVE POSTGRES_FINANZAS_CLAVE POSTGRES_KEYCLOAK_CLAVE; do
  if [ -z "${!variable:-}" ]; then
    echo "Falta $variable: no se crean los usuarios ni las bases." >&2
    exit 1
  fi
done

crear() {
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v usuario="$1" -v clave="$2" -v base="$3" <<'SQL'
CREATE ROLE :"usuario" LOGIN PASSWORD :'clave';
CREATE DATABASE :"base" OWNER :"usuario";
SQL
  echo "usuario $1 y base $3 listos"
}

crear obras "$POSTGRES_OBRAS_CLAVE" obras_db
crear finanzas "$POSTGRES_FINANZAS_CLAVE" finanzas_db
crear keycloak "$POSTGRES_KEYCLOAK_CLAVE" keycloak_db
