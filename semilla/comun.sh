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
# 601 · Modo demostración (semilla.sh --entorno archivo con SEMILLA_DEMO=si): cada servicio carga con su imagen
DEMO=no
RUTA_ENV="$INFRA/.env"

if [ -t 1 ]; then ROJO=$'\e[31m'; AMARILLO=$'\e[33m'; CIAN=$'\e[36m'; NORMAL=$'\e[0m'; else ROJO=; AMARILLO=; CIAN=; NORMAL=; fi

detener() { printf '\n%sERROR: %s%s\n' "$ROJO" "$1" "$NORMAL" >&2; exit 1; }
paso() { printf '\n%s== %s%s\n' "$CIAN" "$1" "$NORMAL"; }
aviso() { printf '%sAVISO: %s%s\n' "$AMARILLO" "$1" "$NORMAL"; }

# infra/.env (o el archivo de --entorno) como variables ENV_<NOMBRE> (no se ejecuta: solo líneas NOMBRE=valor)
leer_env() {
  [ -f "$RUTA_ENV" ] || detener "Falta $RUTA_ENV: copia su .env.example a .env y completa los valores."
  local nombre valor
  while IFS='=' read -r nombre valor || [ -n "$nombre" ]; do
    nombre="$(printf '%s' "$nombre" | tr -d '[:space:]')"
    [[ "$nombre" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    valor="${valor%$'\r'}"
    valor="$(printf '%s' "$valor" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    printf -v "ENV_$nombre" '%s' "$valor"
  done < "$RUTA_ENV"
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

# Ruta de un archivo de --entorno: tal cual (o relativa a la carpeta actual) o relativa a infra/
resolver_entorno() {
  local candidato
  for candidato in "$1" "$INFRA/$1"; do
    if [ -f "$candidato" ]; then (cd "$(dirname "$candidato")" && printf '%s/%s' "$(pwd)" "$(basename "$candidato")"); return 0; fi
  done
  detener "No encuentro el archivo de entorno $1 (ni en la carpeta actual ni en infra/)."
}

# Archivo de una variable del entorno de demostración, relativo a la carpeta de ese archivo; se detiene si no existe
archivo_del_entorno() {
  local variable="$1" valor
  valor="$(env_valor "$variable")"
  [ -n "$valor" ] || detener "Falta $variable en $RUTA_ENV (modo demostración)."
  case "$valor" in /*|[A-Za-z]:*) ;; *) valor="$(dirname "$RUTA_ENV")/$valor" ;; esac
  [ -f "$valor" ] || detener "$variable apunta a $valor, que no existe."
  (cd "$(dirname "$valor")" && printf '%s/%s' "$(pwd)" "$(basename "$valor")")
}

# Ruta para docker: en Git Bash, la de Windows (C:/…), que sirve aunque MSYS_NO_PATHCONV apague la conversión
ruta_docker() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# Ayudante de Node con el entorno elegido (y la CA local del ensayo, si el entorno la trae en CA_LOCAL)
ayudante() { SEMILLA_ENTORNO="$RUTA_ENV" node "$AYUDANTE" "$@"; }

version_mayor() {
  if [[ "$1" =~ ([0-9]+)\.([0-9]+) ]]; then echo $(( BASH_REMATCH[1] * 100 + BASH_REMATCH[2] )); else echo 0; fi
}

# AWS CLI en el contenedor s3-cli (perfil herramientas); en modo demostración (601), el del grupo del S3 compatible
ejecutar_s3() {
  local compose=(compose)
  [ "$DEMO" = si ] && compose=(compose -f "$(ruta_docker "$COMPOSE_S3")" --env-file "$(ruta_docker "$RUTA_ENV")")
  (cd "$INFRA" && MSYS_NO_PATHCONV=1 docker "${compose[@]}" --profile herramientas run --rm --no-TTY s3-cli "$@" 2>&1) \
    | grep -Ev '^[[:space:]]*Container .*(Creat|Start|Stopp|Remov)'
  return "${PIPESTATUS[0]}"
}

# psql en el contenedor psql-cli (perfil herramientas), contra reportes_db con el usuario ia (401)
ejecutar_psql() {
  (cd "$INFRA" && docker compose --profile herramientas run --rm --no-TTY psql-cli "$@" 2>&1) \
    | grep -Ev '^[[:space:]]*Container .*(Creat|Start|Stopp|Remov)'
  return "${PIPESTATUS[0]}"
}

# 401: vacía el modelo de lectura (rpt_*, evento_aplicado, carga_inicial). Si reportes_db no responde (por ejemplo,
# todavía no se creó para el servicio de IA), avisa y sigue: no hay nada que vaciar ahí.
vaciar_reportes() {
  local salida
  if salida="$(ejecutar_psql -f /vaciar-reportes.sql)"; then
    printf '%s\n' "$salida" | sed -n 's/.*NOTICE: *//p' | sed 's/^/ok       /'
    REPORTES=si
  else
    printf '%s\n' "$salida"
    aviso 'No se pudo vaciar reportes_db (salida de arriba). Si el servicio de IA todavía no tiene su base, ignóralo; si la tiene, revisa POSTGRES_IA_CLAVE en infra/.env y vacíala antes de la carga inicial.'
    REPORTES=no
  fi
}

# 503: vacía ia_db.consumo_atipico con el servicio mongo-cli (perfil herramientas). Si MongoDB no responde, avisa y sigue.
vaciar_atipicos() {
  local salida
  if salida="$( (cd "$INFRA" && MSYS_NO_PATHCONV=1 docker compose --profile herramientas run --rm --no-TTY mongo-cli /vaciar-ia.js 2>&1) \
      | grep -Ev '^[[:space:]]*Container .*(Creat|Start|Stopp|Remov)'; exit "${PIPESTATUS[0]}")"; then
    printf '%s\n' "$salida" | sed 's/^/ok       /'
  else
    printf '%s\n' "$salida"
    aviso "No se pudo vaciar ia_db.consumo_atipico (salida de arriba): los consumos atípicos viejos quedan hasta que lo vacíes."
  fi
}

# Guardas, herramientas y piezas que deben responder. Uso: comprobar_entorno [--rabbitmq] [--entorno archivo]
comprobar_entorno() {
  local opciones=() entorno=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --entorno) entorno="${2:-}"; shift 2 ;;
      *) opciones+=("$1"); shift ;;
    esac
  done
  paso 'Guardas'
  if [ -n "$entorno" ]; then RUTA_ENV="$(resolver_entorno "$entorno")" || exit 1; fi
  leer_env
  [ -n "$entorno" ] && echo "ok       entorno $RUTA_ENV"
  # 601: SEMILLA_DEMO=si permite cargar (nunca vaciar) los datos de demostración fuera de desarrollo
  if [ "$(env_valor SEMILLA_DEMO)" = 'si' ]; then
    DEMO=si
    echo 'ok       SEMILLA_DEMO=si (datos de demostración: solo carga, nunca vaciado)'
  elif [ "$(env_valor SEMILLA_PERMITIDA)" = 'si' ]; then
    echo 'ok       SEMILLA_PERMITIDA=si'
  else
    detener "La carga de datos de prueba no está permitida aquí: falta SEMILLA_PERMITIDA=si en $RUTA_ENV (solo en desarrollo; para una demostración, SEMILLA_DEMO=si)."
  fi

  BUCKET="$(env_valor S3_BUCKET)"
  if [ -n "$BUCKET" ] && [ "$DEMO" != si ] && [[ "$BUCKET" != supervision-dev-* ]]; then
    detener "El bucket '$BUCKET' no es de desarrollo: S3_BUCKET debe empezar con supervision-dev- (o SEMILLA_DEMO=si). No se toca."
  fi
  if [ -n "$BUCKET" ] && [ -n "$(env_valor AWS_ACCESS_KEY_ID)" ] && [ -n "$(env_valor AWS_SECRET_ACCESS_KEY)" ]; then
    FOTOS=si
    echo "ok       bucket s3://$BUCKET"
  else
    FOTOS=no
    aviso "Se saltan las fotos: faltan S3_BUCKET, AWS_ACCESS_KEY_ID o AWS_SECRET_ACCESS_KEY en $RUTA_ENV. Las filas de las fotos se cargan igual en Obras, pero las imágenes no se verán hasta subirlas (completa .env y vuelve a correr semilla: no duplica nada)."
  fi

  paso 'Herramientas y proyectos'
  local nodo php
  nodo="$(node -v 2>/dev/null)"
  [ "$(version_mayor "$nodo")" -ge 2400 ] || detener "Hace falta Node 24 (hay '$nodo'): nvm use 24."
  echo "ok       Node $nodo"
  if [ "$DEMO" = si ]; then
    # 601: cada servicio carga con su imagen de producción, en el grupo (compose) donde corre
    docker info --format '{{.ServerVersion}}' >/dev/null 2>&1 \
      || detener 'Docker no responde (en modo demostración cada servicio carga con su imagen).'
    COMPOSE_OBRAS="$(archivo_del_entorno SEMILLA_COMPOSE_OBRAS)" || exit 1
    COMPOSE_FINANZAS="$(archivo_del_entorno SEMILLA_COMPOSE_FINANZAS)" || exit 1
    COMPOSE_MATERIALES="$(archivo_del_entorno SEMILLA_COMPOSE_MATERIALES)" || exit 1
    # 602: en la nube, cada carga corre dentro de su máquina por un contexto de Docker (vacío = Docker local)
    CONTEXTO_OBRAS="$(env_valor SEMILLA_CONTEXTO_OBRAS)"
    CONTEXTO_FINANZAS="$(env_valor SEMILLA_CONTEXTO_FINANZAS)"
    CONTEXTO_MATERIALES="$(env_valor SEMILLA_CONTEXTO_MATERIALES)"
    echo "ok       Obras con su imagen ($COMPOSE_OBRAS${CONTEXTO_OBRAS:+, contexto $CONTEXTO_OBRAS})"
    echo "ok       Finanzas con su imagen ($COMPOSE_FINANZAS${CONTEXTO_FINANZAS:+, contexto $CONTEXTO_FINANZAS})"
    echo "ok       Materiales con su imagen ($COMPOSE_MATERIALES${CONTEXTO_MATERIALES:+, contexto $CONTEXTO_MATERIALES})"
    if [ "$FOTOS" = si ]; then
      COMPOSE_S3="$(archivo_del_entorno SEMILLA_COMPOSE_S3)" || exit 1
      echo "ok       S3 con s3-cli ($COMPOSE_S3)"
    fi
  else
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
  fi

  paso 'Piezas que deben responder'
  ayudante comprobar "${opciones[@]}" || exit 1
  if [ "$FOTOS" = si ]; then
    local salida
    salida="$(ejecutar_s3 s3api head-bucket --bucket "$BUCKET")" \
      || detener "El bucket s3://$BUCKET no responde con las claves de $RUTA_ENV:"$'\n'"$salida"
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

# Líneas de resumen que imprimió un servicio (las que dicen «resumen» o «D = AAAA-MM-DD»), sin colores de consola
anotar_resumen() {
  local nombre="$1" lineas
  # Una línea en JSON (la imagen de Obras con el perfil prod, 601) se lee por su «message»
  lineas="$(sed -e $'s/\e\\[[0-9;]*m//g' -e 's/^[[:space:]]*//' \
    -E -e '/^\{.*"message":"/{s/^\{.*"message":"(([^"\\]|\\.)*)".*/\1/;s/\\"/"/g;}' "$TEMPORAL/$nombre.log" | grep -iE 'resumen|(^|[^[:alnum:]])D[[:space:]]*=[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}' | grep -v '^>')"
  [ -n "$lineas" ] || lineas='(el comando no imprimió una línea de resumen; revisa su salida arriba)'
  while IFS= read -r linea; do RESUMEN+="$(printf '%-11s %s' "$nombre:" "$linea")"$'\n'; done <<< "$lineas"
}

# 601: carga de un servicio con su imagen de producción (modo demostración), en el grupo donde corre.
# Uso: ejecutar_en_imagen <nombre> <compose> <servicio> [-c contexto] [-e VAR=valor ...] [-- comando...]
# 602: -c corre la carga en otro Docker (un contexto por SSH: la máquina de la nube); vacío, el Docker local.
ejecutar_en_imagen() {
  local nombre="$1" archivo="$2" servicio="$3" variables=() comando=() contexto=()
  shift 3
  while [ $# -gt 0 ]; do
    case "$1" in
      -c) [ -n "$2" ] && contexto=(--context "$2"); shift 2 ;;
      -e) variables+=(-e "$2"); shift 2 ;;
      --) shift; comando=("$@"); break ;;
      *) detener "ejecutar_en_imagen: argumento inesperado $1" ;;
    esac
  done
  ejecutar "$nombre" "$INFRA" docker "${contexto[@]}" compose -f "$(ruta_docker "$archivo")" --env-file "$(ruta_docker "$RUTA_ENV")" run --rm --no-deps --no-TTY \
    -e SEMILLA_DEMO=si -e "SEMILLA_FECHA=$SEMILLA_FECHA" "${variables[@]}" "$servicio" "${comando[@]}"
}

contar_fotos() {
  local lista
  lista="$(ejecutar_s3 s3 ls "s3://$BUCKET/fotos/" --recursive)" || detener "No se pudo listar s3://$BUCKET/fotos/:"$'\n'"$lista"
  printf '%s\n' "$lista" | grep -cE 'fotos/b0000000-0000-4000-8000-00000000000[1-3]/f1000000-[0-9a-f-]{27}\.jpg$'
}

# Pasos 2 a 6 de la sección 12: D, Keycloak, Obras → Finanzas → Materiales, fotos y resumen.
# Uso: cargar_datos [cargar|recargar]; recargar hace que Obras vacíe sus tablas antes de cargar (lo usa recargar.sh).
cargar_datos() {
  local modo_obras="${1:-cargar}" fecha codigo
  paso 'Fecha de carga'
  fecha="$(ayudante fecha)" || exit 1
  export SEMILLA_FECHA="$fecha"
  echo "D = $fecha (SEMILLA_FECHA, la misma para los tres servicios)"

  paso 'Keycloak: usuarios de prueba'
  ayudante usuarios
  codigo=$?
  if [ "$codigo" -eq 3 ]; then
    detener 'Reimporta el realm: ./semilla/recargar.sh lo hace, o solo Keycloak con "docker compose up -d --force-recreate keycloak" en infra (borra lo cambiado a mano en el panel).'
  fi
  [ "$codigo" -eq 0 ] || exit 1

  if [ "$DEMO" = si ]; then
    # 601: modo demostración; solo carga, nunca recargar
    [ "$modo_obras" = cargar ] || detener 'Con SEMILLA_DEMO=si solo se carga: el vaciado está prohibido fuera de desarrollo.'
    paso 'Obras (imagen de producción, perfiles prod y semilla)'
    ejecutar_en_imagen Obras "$COMPOSE_OBRAS" obras -c "$CONTEXTO_OBRAS" -e SPRING_PROFILES_ACTIVE=prod,semilla
    anotar_resumen Obras

    paso 'Finanzas (imagen de producción, DatosPruebaSeeder)'
    ejecutar_en_imagen Finanzas "$COMPOSE_FINANZAS" finanzas-api -c "$CONTEXTO_FINANZAS" -- php artisan db:seed --class=DatosPruebaSeeder --force
    anotar_resumen Finanzas

    paso 'Materiales (imagen de producción, semilla cargar)'
    ejecutar_en_imagen Materiales "$COMPOSE_MATERIALES" materiales -c "$CONTEXTO_MATERIALES" -- node dist/semilla/main.js cargar
    anotar_resumen Materiales
  else
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
  fi

  paso 'Fotos al bucket S3'
  if [ "$FOTOS" = si ]; then
    ejecutar_s3 s3 sync /semilla/fotos "s3://$BUCKET/fotos/" --exclude '*' --include '*.jpg' --no-progress \
      || detener 'No se pudieron subir las fotos (salida de arriba).'
    RESUMEN+="$(printf '%-11s %s' 'Fotos:' "$(contar_fotos) de 10 imágenes en s3://$BUCKET/fotos/")"$'\n'
  else
    aviso "Fotos saltadas (sin bucket o sin claves en $RUTA_ENV)."
    RESUMEN+="$(printf '%-11s %s' 'Fotos:' "saltadas: falta S3_BUCKET o las claves en $RUTA_ENV")"$'\n'
  fi

  paso "Resumen (fecha de carga D = $fecha)"
  RESUMEN+="$(printf '%-11s %s' 'Keycloak:' '9 usuarios de prueba con su id fijo')"$'\n'
  printf '%s' "$RESUMEN"
  echo
  if [ "$DEMO" = si ]; then
    echo 'Los indicadores son exactos el día D. En modo demostración nada se vacía: para empezar de cero se borran los volúmenes del entorno.'
  else
    echo 'Los indicadores son exactos el día D; antes de una demostración, ./semilla/recargar.sh.'
  fi
}
