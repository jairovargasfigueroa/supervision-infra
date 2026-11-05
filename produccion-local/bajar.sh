#!/usr/bin/env bash
# 601 · Baja la «producción local» (los tres grupos o uno). Conserva los datos salvo con --datos, que borra los
# volúmenes de esos grupos (bases, colas, n8n, MinIO y los certificados de Caddy; nunca el modelo de Ollama de
# desarrollo, que es externo). No toca el entorno de desarrollo (proyecto «supervision»).
# Uso: ./produccion-local/bajar.sh [--grupo azure|google|aws] [--datos]
. "$(dirname "$0")/comun.sh"

GRUPO=""; DATOS=no
while [ $# -gt 0 ]; do
  case "$1" in
    --grupo) GRUPO="${2:-}"; shift 2 ;;
    --datos) DATOS=si; shift ;;
    *) detener "Opción desconocida: $1 (uso: bajar.sh [--grupo azure|google|aws] [--datos])" ;;
  esac
done
case "$GRUPO" in ''|azure|google|aws) ;; *) detener "Grupo desconocido: $GRUPO (azure, google o aws)." ;; esac
[ -f "$RUTA_ENV" ] || detener 'Falta produccion-local/.env.'
grupos=(aws google azure)
[ -n "$GRUPO" ] && grupos=("$GRUPO")
for g in "${grupos[@]}"; do
  paso "Grupo $g"
  argumentos=(--profile '*' down --remove-orphans)
  [ "$DATOS" = si ] && argumentos+=(--volumes)
  compose "$g" "${argumentos[@]}" || detener "No se pudo bajar el grupo $g (salida de arriba)."
done
[ "$DATOS" = si ] && echo 'Volúmenes borrados: al levantar, las bases empiezan vacías y Keycloak vuelve a importar el realm.'
exit 0
