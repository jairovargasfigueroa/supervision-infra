#!/bin/bash
# 401 · Base de reportes (capa 4): usuario propio "ia" y base reportes_db, dueña de ese usuario (así el servicio de IA
# crea sus tablas con Alembic sin ser superusuario). Corre después de init.sql y solo con el volumen vacío.
# 503 · Además, el rol de solo lectura ia_reportes_lector (postgres/lector-reportes.sql, montado en /lector-reportes.sql).
# Las contraseñas salen de POSTGRES_IA_CLAVE y POSTGRES_IA_LECTOR_CLAVE (infra/.env); van como variables de psql para
# no armar SQL a mano.
set -euo pipefail

if [ -z "${POSTGRES_IA_CLAVE:-}" ]; then
  echo 'Falta POSTGRES_IA_CLAVE: no se crea el usuario ia ni reportes_db.' >&2
  exit 1
fi
if [ -z "${POSTGRES_IA_LECTOR_CLAVE:-}" ]; then
  echo 'Falta POSTGRES_IA_LECTOR_CLAVE: no se crea el rol ia_reportes_lector (503).' >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v clave="$POSTGRES_IA_CLAVE" <<'SQL'
CREATE ROLE ia LOGIN PASSWORD :'clave';
CREATE DATABASE reportes_db OWNER ia;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v clave="$POSTGRES_IA_LECTOR_CLAVE" \
  -f /lector-reportes.sql
