#!/bin/bash
# 401 · Base de reportes (capa 4): usuario propio "ia" y base reportes_db, dueña de ese usuario (así el servicio de IA
# crea sus tablas con Alembic sin ser superusuario). Corre después de init.sql y solo con el volumen vacío.
# La contraseña sale de POSTGRES_IA_CLAVE (infra/.env); va como variable de psql para no armar SQL a mano.
set -euo pipefail

if [ -z "${POSTGRES_IA_CLAVE:-}" ]; then
  echo 'Falta POSTGRES_IA_CLAVE: no se crea el usuario ia ni reportes_db.' >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v clave="$POSTGRES_IA_CLAVE" <<'SQL'
CREATE ROLE ia LOGIN PASSWORD :'clave';
CREATE DATABASE reportes_db OWNER ia;
SQL
