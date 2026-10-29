#!/usr/bin/env bash
# Funciones comunes de semilla.sh y recargar.sh (011). Se carga con: . "$(dirname "$0")/comun.sh"
# Mismo comportamiento que comun.ps1. Pasos y guardas: docs/datos-prueba.md, sección 12, de supervision-docs.
set -uo pipefail

SEMILLA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$(cd "$SEMILLA_DIR/.." && pwd)"
AYUDANTE="$SEMILLA_DIR/plataforma.mjs"
TEMPORAL="$(mktemp -d)"
trap 'rm -rf "$TEMPORAL"' EXIT
RESUMEN=""

if [ -t 1 ]; then ROJO=$'\e[31m'; AMARILLO=$'\e[33m'; CIAN=$'\e[36m'; NORMAL=$'\e[0m'; else ROJO=; AMARILLO=; CIAN=; NORMAL=; fi

detener() { printf '\n%sERROR: %s%s\n' "$ROJO" "$1" "$NORMAL" >&2; exit 1; }
paso() { printf '\n%s== %s%s\n' "$CIAN" "$1" "$NORMAL"; }
aviso() { printf '%sAVISO: %s%s\n' "$AMARILLO" "$1" "$NORMAL"; }

# infra/.env como variables ENV_<NOMBRE> (no se ejecuta: solo líneas NOMBRE=valor)
leer_env() {
  [ -f "$INFRA/.env" ] || detener 'Falta infra/.env: copia .env.example a .env y completa los valores.'
  local nombre valor
  while IFS='=' read -r nombre valor || [ -n "$nombre" ]; do
    nombre="$(printf '%s' "$nombre" | tr -d '[:space:]')"
    [[ "$nombre" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    valor="${valor%$'\r'}"
    valor="$(printf '%s' "$valor" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    printf -v "ENV_$nombre" '%s' "$valor"
  done < "$INFRA/.env"
}
env_valor() { local variable="ENV_$1"; printf '%s' "${!variable:-}"; }

# Carpeta de un proyecto: la variable de .env (relativa a infra/) o la carpeta hermana por defecto
carpeta_proyecto() {
  local variable="$1" por_defecto="$2" marca="$3" valor
  valor="$(env_valor "$variable")"
  [ -n "$valor" ] || valor="$por_defecto"
  case "$valor" in /*|[A-Za-z]:*) ;; *) valor="$INFRA/$valor" ;; esac
  [ -e "$valor/$marca" ] || detener "No encuentro el proyecto en $valor (falta $marca). Clónalo o corrige $variable en infra/.env."
  (cd "$valor" && pwd)
}

version_mayor() {
  if [[ "$1" =~ ([0-9]+)\.([0-9]+) ]]; then echo $(( BASH_REMATCH[1] * 100 + BASH_REMATCH[2] )); else echo 0; fi
}

# AWS CLI en el contenedor s3-cli (perfil herramientas)
ejecutar_s3() {
  (cd "$INFRA" && docker compose --profile herramientas run --rm --no-TTY s3-cli "$@" 2>&1) \
    | grep -Ev '^[[:space:]]*Container .*(Creat|Start|Stopp|Remov)'
  return "${PIPESTATUS[0]}"
}

# Guardas, herramientas y piezas que deben responder. Uso: comprobar_entorno [--rabbitmq]
comprobar_entorno() {
  paso 'Guardas'
  leer_env
  [ "$(env_valor SEMILLA_PERMITIDA)" = 'si' ] \
    || detener 'La carga de datos de prueba no está permitida aquí: falta SEMILLA_PERMITIDA=si en infra/.env (solo en desarrollo).'
  echo 'ok       SEMILLA_PERMITIDA=si'

  BUCKET="$(env_valor S3_BUCKET)"
  if [ -n "$BUCKET" ] && [[ "$BUCKET" != supervision-dev-* ]]; then
    detener "El bucket '$BUCKET' no es de desarrollo: S3_BUCKET debe empezar con supervision-dev-. No se toca."
  fi
  if [ -n "$BUCKET" ] && [ -n "$(env_valor AWS_ACCESS_KEY_ID)" ] && [ -n "$(env_valor AWS_SECRET_ACCESS_KEY)" ]; then
    FOTOS=si
    echo "ok       bucket s3://$BUCKET"
  else
    FOTOS=no
    aviso 'Se saltan las fotos: faltan S3_BUCKET, AWS_ACCESS_KEY_ID o AWS_SECRET_ACCESS_KEY en infra/.env. Las filas de las fotos se cargan igual en Obras, pero las imágenes no se verán hasta subirlas (completa .env y vuelve a correr semilla: no duplica nada).'
  fi

  paso 'Herramientas y proyectos'
  local nodo php
  nodo="$(node -v 2>/dev/null)"
  [ "$(version_mayor "$nodo")" -ge 2400 ] || detener "Hace falta Node 24 (hay '$nodo'): nvm use 24."
  echo "ok       Node $nodo"
  php="$(php -r 'echo PHP_VERSION;' 2>/dev/null)"
  [ "$(version_mayor "$php")" -ge 803 ] || detener "Hace falta PHP 8.3 o más para Finanzas (hay '$php')."
  echo "ok       PHP $php"
  if [ "$FOTOS" = si ]; then
    docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 || detener 'Docker no responde (lo usa s3-cli para las fotos).'
  fi
  OBRAS_DIR="$(carpeta_proyecto OBRAS_DIR ../services/obras mvnw)" || exit 1
  FINANZAS_DIR="$(carpeta_proyecto FINANZAS_DIR ../services/finanzas artisan)" || exit 1
  MATERIALES_DIR="$(carpeta_proyecto MATERIALES_DIR ../services/materiales package.json)" || exit 1
  echo "ok       Obras $OBRAS_DIR"
  echo "ok       Finanzas $FINANZAS_DIR"
  echo "ok       Materiales $MATERIALES_DIR"

  paso 'Piezas que deben responder'
  node "$AYUDANTE" comprobar "$@" || exit 1
  if [ "$FOTOS" = si ]; then
    local salida
    salida="$(ejecutar_s3 s3api head-bucket --bucket "$BUCKET")" \
      || detener "El bucket s3://$BUCKET no responde con las claves de infra/.env:"$'\n'"$salida"
    echo "ok       bucket s3://$BUCKET"
  fi
}

# Corre un comando en una carpeta mostrando su salida, la guarda en $TEMPORAL/<nombre>.log y se detiene si falla.
ejecutar() {
  local nombre="$1" carpeta="$2"
  shift 2
  (cd "$carpeta" && "$@" 2>&1) | tee "$TEMPORAL/$nombre.log"
  local codigo="${PIPESTATUS[0]}"
  [ "$codigo" -eq 0 ] || detener "$nombre terminó con error ($codigo). Revisa la salida de arriba; los otros servicios no se tocaron después de este paso."
}

# Líneas de resumen que imprimió un servicio (las que dicen «resumen»), sin colores de consola
anotar_resumen() {
  local nombre="$1" lineas
  lineas="$(sed -e $'s/\e\\[[0-9;]*m//g' -e 's/^[[:space:]]*//' "$TEMPORAL/$nombre.log" | grep -i 'resumen' | grep -v '^>')"
  [ -n "$lineas" ] || lineas='(el comando no imprimió una línea de resumen; revisa su salida arriba)'
  while IFS= read -r linea; do RESUMEN+="$(printf '%-11s %s' "$nombre:" "$linea")"$'\n'; done <<< "$lineas"
}

contar_fotos() {
  local lista
  lista="$(ejecutar_s3 s3 ls "s3://$BUCKET/fotos/" --recursive)" || detener "No se pudo listar s3://$BUCKET/fotos/:"$'\n'"$lista"
  printf '%s\n' "$lista" | grep -cE 'fotos/b0000000-0000-4000-8000-00000000000[1-3]/f1000000-[0-9a-f-]{28}\.jpg$'
}

# Pasos 2 a 6 de la sección 12: D, Keycloak, Obras → Finanzas → Materiales, fotos y resumen.
# Uso: cargar_datos [cargar|recargar]; recargar hace que Obras vacíe sus tablas antes de cargar (lo usa recargar.sh).
cargar_datos() {
  local modo_obras="${1:-cargar}" fecha codigo
  paso 'Fecha de carga'
  fecha="$(node "$AYUDANTE" fecha)" || exit 1
  export SEMILLA_FECHA="$fecha"
  echo "D = $fecha (SEMILLA_FECHA, la misma para los tres servicios)"

  paso 'Keycloak: usuarios de prueba'
  node "$AYUDANTE" usuarios
  codigo=$?
  if [ "$codigo" -eq 3 ]; then
    detener 'Reimporta el realm: ./semilla/recargar.sh lo hace, o solo Keycloak con "docker compose up -d --force-recreate keycloak" en infra (borra lo cambiado a mano en el panel).'
  fi
  [ "$codigo" -eq 0 ] || exit 1

  paso "Obras (perfil semilla, modo $modo_obras)"
  local argumentos=(spring-boot:run -Dspring-boot.run.profiles=semilla)
  [ "$modo_obras" = recargar ] && argumentos+=(-Dspring-boot.run.arguments=--semilla.modo=recargar)
  ejecutar Obras "$OBRAS_DIR" ./mvnw "${argumentos[@]}"
  anotar_resumen Obras

  paso 'Finanzas (DatosPruebaSeeder)'
  ejecutar Finanzas "$FINANZAS_DIR" php artisan db:seed --class=DatosPruebaSeeder --force
  anotar_resumen Finanzas

  paso 'Materiales (npm run semilla)'
  ejecutar Materiales "$MATERIALES_DIR" npm run semilla
  anotar_resumen Materiales

  paso 'Fotos al bucket S3 de desarrollo'
  if [ "$FOTOS" = si ]; then
    ejecutar_s3 s3 sync /semilla/fotos "s3://$BUCKET/fotos/" --exclude '*' --include '*.jpg' --no-progress \
      || detener 'No se pudieron subir las fotos (salida de arriba).'
    RESUMEN+="$(printf '%-11s %s' 'Fotos:' "$(contar_fotos) de 10 imágenes en s3://$BUCKET/fotos/")"$'\n'
  else
    aviso 'Fotos saltadas (sin bucket o sin claves en infra/.env).'
    RESUMEN+="$(printf '%-11s %s' 'Fotos:' 'saltadas: falta S3_BUCKET o las claves en infra/.env')"$'\n'
  fi

  paso "Resumen (fecha de carga D = $fecha)"
  RESUMEN+="$(printf '%-11s %s' 'Keycloak:' '9 usuarios de prueba con su id fijo')"$'\n'
  printf '%s' "$RESUMEN"
  echo
  echo 'Los indicadores son exactos el día D; antes de una demostración, ./semilla/recargar.sh.'
}
