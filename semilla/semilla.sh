#!/usr/bin/env bash
# Carga los datos de prueba (011, docs/datos-prueba.md) en Obras, Finanzas, Materiales y el bucket S3 de desarrollo.
# Idempotente: lo que ya existe por id no se duplica ni se pisa (para volver al estado del documento: recargar.sh).
# Uso: ./semilla/semilla.sh        (D = hoy en La Paz; para fijarla: SEMILLA_FECHA=2026-10-28 ./semilla/semilla.sh)
. "$(dirname "$0")/comun.sh"

comprobar_entorno
cargar_datos cargar
