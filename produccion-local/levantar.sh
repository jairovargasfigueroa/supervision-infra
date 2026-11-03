#!/usr/bin/env bash
# 601 · Levanta la «producción local»: los tres grupos (azure, google, aws) con las imágenes de producción y los
# frontends compilados, HTTPS con la CA local y RabbitMQ por TLS, y termina con los datos de demostración y la carga
# inicial de la base de reportes. No toca el entorno de desarrollo (proyecto «supervision»).
# Uso: ./produccion-local/levantar.sh [--grupo azure|google|aws] [--desde-ghcr] [--sin-compilar] [--sin-frontends]
#                                     [--sin-datos] [--con-ollama]
# (las opciones, como en levantar.ps1)
. "$(dirname "$0")/comun.sh"

GRUPO=""; DESDE_GHCR=no; SIN_COMPILAR=no; SIN_FRONTENDS=no; SIN_DATOS=no; CON_OLLAMA=no
while [ $# -gt 0 ]; do
  case "$1" in
    --grupo) GRUPO="${2:-}"; shift 2 ;;
    --desde-ghcr) DESDE_GHCR=si; shift ;;
    --sin-compilar) SIN_COMPILAR=si; shift ;;
    --sin-frontends) SIN_FRONTENDS=si; shift ;;
    --sin-datos) SIN_DATOS=si; shift ;;
    --con-ollama) CON_OLLAMA=si; shift ;;
    *) detener "Opción desconocida: $1" ;;
  esac
done
case "$GRUPO" in ''|azure|google|aws) ;; *) detener "Grupo desconocido: $GRUPO (azure, google o aws)." ;; esac
leer_env
grupos=("${GRUPOS[@]}")
[ -n "$GRUPO" ] && grupos=("$GRUPO")
docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || detener 'Docker no responde.'

paso 'Certificados (CA local y RabbitMQ)'
"$DIR/certificados.sh" || exit 1

if [ "$DESDE_GHCR" = si ]; then
  # La variable del proceso manda sobre la del .env en docker compose
  export IMAGEN_ETIQUETA=main
  paso 'Imágenes publicadas en GHCR (etiqueta main)'
  for g in "${grupos[@]}"; do compose "$g" pull --ignore-pull-failures || detener "No se pudieron descargar las imágenes del grupo $g."; done
else
  paso 'Imágenes de producción (se construyen desde las carpetas de los proyectos)'
  for g in "${grupos[@]}"; do compose "$g" build || detener "No se pudieron construir las imágenes del grupo $g (salida de arriba)."; done
fi

if [[ " ${grupos[*]} " == *" azure "* ]] && [ "$SIN_FRONTENDS" != si ]; then
  paso 'Frontends compilados'
  argumentos=()
  [ "$SIN_COMPILAR" = si ] && argumentos+=(--sin-compilar)
  "$DIR/publicar-frontends.sh" "${argumentos[@]}" || exit 1
fi
mkdir -p "$DIR/sitios"

for g in "${grupos[@]}"; do
  paso "Grupo $g"
  perfiles=()
  [ "$g" = google ] && [ "$CON_OLLAMA" = si ] && perfiles+=(--profile ollama)
  compose "$g" "${perfiles[@]}" up -d --no-build || detener "No se pudo levantar el grupo $g (salida de arriba)."
  esperar_grupo "$g" || detener "El grupo $g no quedó sano."
done

if [ "$SIN_DATOS" != si ]; then
  if [ -n "$GRUPO" ]; then
    echo
    echo 'Datos de demostración: cuando estén los tres grupos, ./semilla/semilla.sh --entorno produccion-local/.env y'
    echo '  docker compose -f produccion-local/compose.google.yml --env-file produccion-local/.env run --rm ia-carga-inicial'
  else
    paso 'Datos de demostración (semilla con SEMILLA_DEMO=si)'
    "$INFRA/semilla/semilla.sh" --entorno "$RUTA_ENV" || detener 'La semilla de demostración falló (salida de arriba).'
    paso 'Carga inicial de la base de reportes (401)'
    compose google run --rm --no-TTY ia-carga-inicial || detener 'La carga inicial de reportes falló (salida de arriba).'
  fi
fi

paso 'Listo'
for par in 'ERP ERP_URL' 'Portal PORTAL_URL' 'Keycloak KEYCLOAK_URL' 'Gateway GATEWAY_URL' 'Mailpit MAILPIT_URL' \
  'n8n N8N_URL' 'RabbitMQ RABBITMQ_PANEL_URL' 'IA IA_URL' 'Materiales MATERIALES_URL' 'Sincronización SINCRONIZACION_URL'; do
  set -- $par
  printf '%-18s %s\n' "$1" "$(env_valor "$2")"
done
echo
echo 'El navegador avisa una vez por dirección que el certificado no es de confianza (CA local: produccion-local/certificados/ca.crt; README, «Producción local»).'
echo 'Prueba de humo: node pruebas/humo-despliegue.mjs --entorno produccion-local/.env [--completa]'
