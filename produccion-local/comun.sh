#!/usr/bin/env bash
# 601 · Funciones comunes de levantar, bajar y publicar-frontends (Bash). Mismo comportamiento que comun.ps1.
# Se carga con: . "$(dirname "$0")/comun.sh"
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$(cd "$DIR/.." && pwd)"
RUTA_ENV="$DIR/.env"
# Orden de arranque: azure es el centro (Keycloak y RabbitMQ), después google y aws
GRUPOS=(azure google aws)

if [ -t 1 ]; then ROJO=$'\e[31m'; CIAN=$'\e[36m'; NORMAL=$'\e[0m'; else ROJO=; CIAN=; NORMAL=; fi
detener() { printf '\n%sERROR: %s%s\n' "$ROJO" "$1" "$NORMAL" >&2; exit 1; }
paso() { printf '\n%s== %s%s\n' "$CIAN" "$1" "$NORMAL"; }

# .env de esta carpeta como variables ENV_<NOMBRE> (no se ejecuta: solo líneas NOMBRE=valor; quita comillas)
leer_env() {
  [ -f "$RUTA_ENV" ] || detener 'Falta produccion-local/.env: copia produccion-local/.env.example a .env y completa los valores.'
  local nombre valor
  while IFS='=' read -r nombre valor || [ -n "$nombre" ]; do
    nombre="$(printf '%s' "$nombre" | tr -d '[:space:]')"
    [[ "$nombre" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    valor="${valor%$'\r'}"
    valor="$(printf '%s' "$valor" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    if [[ "$valor" =~ ^\'(.*)\'$ ]] || [[ "$valor" =~ ^\"(.*)\"$ ]]; then valor="${BASH_REMATCH[1]}"; fi
    printf -v "ENV_$nombre" '%s' "$valor"
  done < "$RUTA_ENV"
}
env_valor() { local variable="ENV_$1"; printf '%s' "${!variable:-}"; }

# Ruta de una carpeta de proyecto del .env (relativa a esta carpeta)
carpeta() {
  local valor
  valor="$(env_valor "$1")"
  [ -n "$valor" ] || valor="$2"
  case "$valor" in /*|[A-Za-z]:*) ;; *) valor="$DIR/$valor" ;; esac
  printf '%s' "$valor"
}

# Ruta para docker: en Git Bash, la de Windows (C:/…), que sirve aunque MSYS_NO_PATHCONV apague la conversión
ruta_docker() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# docker compose de un grupo, con el .env de esta carpeta
compose() {
  local grupo="$1"
  shift
  docker compose -f "$(ruta_docker "$DIR/compose.$grupo.yml")" --env-file "$(ruta_docker "$RUTA_ENV")" "$@"
}

# Espera a que todos los contenedores del grupo estén corriendo (y sanos si tienen healthcheck) y a que los de una
# sola vez (rabbitmq-init, mongo-init, minio-init) terminen con 0. No usa "up --wait", que toma como fallo a los que
# terminan. Uso: esperar_grupo <grupo> [segundos]
esperar_grupo() {
  local grupo="$1" limite=$((SECONDS + ${2:-900})) filas servicio estado salud codigo pendientes fallidos
  while [ "$SECONDS" -lt "$limite" ]; do
    filas="$(compose "$grupo" ps -a --format '{{.Service}}|{{.State}}|{{.Health}}|{{.ExitCode}}' 2>/dev/null)"
    pendientes=""
    fallidos=""
    while IFS='|' read -r servicio estado salud codigo; do
      [ -n "$servicio" ] || continue
      if [ "$estado" = exited ]; then
        [ "$codigo" = 0 ] || fallidos+=" $servicio(terminó con $codigo)"
      elif [ "$estado" != running ] || { [ -n "$salud" ] && [ "$salud" != healthy ]; }; then
        if [ "$salud" = unhealthy ]; then fallidos+=" $servicio(unhealthy)"; else pendientes+=" $servicio"; fi
      fi
    done <<< "$filas"
    if [ -n "$fallidos" ]; then
      printf '%sCon problemas en %s:%s. Revisa: docker compose -f produccion-local/compose.%s.yml logs <servicio>%s\n' "$ROJO" "$grupo" "$fallidos" "$grupo" "$NORMAL"
      return 1
    fi
    if [ -n "$filas" ] && [ -z "$pendientes" ]; then echo "ok       grupo $grupo sano"; return 0; fi
    echo "esperando en $grupo:$pendientes"
    sleep 10
  done
  printf '%sEl grupo %s no quedó sano a tiempo: docker compose -f produccion-local/compose.%s.yml ps%s\n' "$ROJO" "$grupo" "$grupo" "$NORMAL"
  return 1
}
