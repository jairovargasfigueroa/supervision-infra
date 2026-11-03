#!/usr/bin/env bash
# Carga los datos de prueba (011, docs/datos-prueba.md) en Obras, Finanzas, Materiales y el bucket S3 de desarrollo.
# Idempotente: lo que ya existe por id no se duplica ni se pisa (para volver al estado del documento: recargar.sh).
# Uso: ./semilla/semilla.sh        (D = hoy en La Paz; para fijarla: SEMILLA_FECHA=2026-10-28 ./semilla/semilla.sh)
# 601 · Datos de demostración: ./semilla/semilla.sh --entorno produccion-local/.env lee ese archivo en lugar de
# infra/.env; con SEMILLA_DEMO=si en él carga en un entorno de producción (cada servicio con su imagen) y nunca vacía.
. "$(dirname "$0")/comun.sh"

ENTORNO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --entorno) ENTORNO="${2:-}"; shift 2 ;;
    --entorno=*) ENTORNO="${1#*=}"; shift ;;
    *) detener "Opción desconocida: $1 (uso: semilla.sh [--entorno archivo])" ;;
  esac
done

comprobar_entorno --entorno "$ENTORNO"
cargar_datos cargar
