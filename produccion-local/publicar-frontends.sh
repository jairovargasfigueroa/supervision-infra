#!/usr/bin/env bash
# 601 · Publica los 5 frontends como archivos estáticos para el Caddy del grupo azure: compila cada uno (npm run build;
# con --sin-compilar toma la carpeta compilada que ya tiene), la copia a produccion-local/sitios/<frontend>/ (el Caddy
# la monta en /sitios) y escribe con envsubst, con las variables de .env, los archivos que dependen del entorno:
# configuracion.json del shell y del portal y federation.manifest.json del shell, a partir de sus plantillas
# (*.plantilla). La misma compilación sirve en cualquier entorno; en la 602 se hace lo mismo hacia el hosting.
# Uso: ./produccion-local/publicar-frontends.sh [--sin-compilar] [--solo erp-shell,portal]
# Ojo: compilar mf-materiales o mf-supervision reescribe su dist/, que también usa su servidor de desarrollo
# (npm start): si está corriendo, detenlo antes o usa --sin-compilar.
. "$(dirname "$0")/comun.sh"
set -e

COMPILAR=si
SOLO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sin-compilar) COMPILAR=no; shift ;;
    --solo) SOLO="${2:-}"; shift 2 ;;
    *) detener "Opción desconocida: $1 (uso: publicar-frontends.sh [--sin-compilar] [--solo a,b])" ;;
  esac
done
command -v envsubst >/dev/null 2>&1 || detener 'Falta envsubst (paquete gettext; Git Bash ya lo trae).'
leer_env

# nombre|variable de la carpeta|carpeta por defecto|salida|plantillas|variables
FRONTENDS=(
  'erp-shell|ERP_SHELL_DIR|../../frontend/erp-shell|dist/erp-shell/browser|configuracion.json federation.manifest.json|KEYCLOAK_URL KEYCLOAK_REALM GATEWAY_URL PORTAL_URL MF_OBRAS_URL MF_MATERIALES_URL MF_SUPERVISION_URL'
  'mf-obras|MF_OBRAS_DIR|../../frontend/mf-obras|dist/mf-obras/browser||'
  'mf-materiales|MF_MATERIALES_DIR|../../frontend/mf-materiales|dist||'
  'mf-supervision|MF_SUPERVISION_DIR|../../frontend/mf-supervision|dist||'
  'portal|PORTAL_DIR|../../frontend/portal|dist|configuracion.json|KEYCLOAK_URL KEYCLOAK_REALM OBRAS_URL ERP_URL'
)

# Plantilla con ${VARIABLE}: envsubst solo reemplaza las de la lista; si falta una en .env, se detiene
escribir_plantilla() {
  local plantilla="$1" destino="$2" variables="$3" variable lista="" resto
  for variable in $variables; do
    if grep -q "\${$variable}" "$plantilla"; then
      [ -n "$(env_valor "$variable")" ] || detener "Falta $variable en produccion-local/.env (la usa $plantilla)."
      export "$variable=$(env_valor "$variable")"
      lista+=" \${$variable}"
    fi
  done
  envsubst "$lista" < "$plantilla" > "$destino"
  resto="$(grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "$destino" | head -1 || true)"
  [ -z "$resto" ] || detener "La plantilla $plantilla usa $resto, que este script no conoce."
}

for linea in "${FRONTENDS[@]}"; do
  IFS='|' read -r nombre variable por_defecto salida plantillas variables <<< "$linea"
  if [ -n "$SOLO" ] && [[ ",$SOLO," != *",$nombre,"* ]]; then continue; fi
  proyecto="$(carpeta "$variable" "$por_defecto")"
  paso "$nombre ($proyecto)"
  [ -f "$proyecto/package.json" ] || detener "No encuentro el proyecto en $proyecto: clónalo o corrige $variable en produccion-local/.env."
  if [ "$COMPILAR" = si ]; then
    if [ ! -d "$proyecto/node_modules" ]; then
      (cd "$proyecto" && npm ci --no-audit --no-fund) || detener "npm ci falló en $nombre."
    fi
    (cd "$proyecto" && npm run build) || detener "npm run build falló en $nombre (salida de arriba)."
  fi
  if [ ! -f "$proyecto/$salida/index.html" ] && [ ! -f "$proyecto/$salida/remoteEntry.json" ]; then
    detener "No hay compilación en $proyecto/$salida (sin index.html ni remoteEntry.json): compila sin --sin-compilar."
  fi
  sitio="$DIR/sitios/$nombre"
  rm -rf "$sitio"
  mkdir -p "$sitio"
  cp -R "$proyecto/$salida/." "$sitio/"
  echo "ok       copiado a produccion-local/sitios/$nombre"
  for archivo in $plantillas; do
    plantilla=""
    for candidato in "$proyecto/$archivo.plantilla" "$proyecto/public/$archivo.plantilla"; do
      if [ -f "$candidato" ]; then plantilla="$candidato"; break; fi
    done
    [ -n "$plantilla" ] || detener "Falta la plantilla $archivo.plantilla en $proyecto (tarea de la 601 de $nombre)."
    escribir_plantilla "$plantilla" "$sitio/$archivo" "$variables"
    echo "ok       $archivo escrito con las direcciones de produccion-local/.env"
  done
done
echo
echo 'Frontends publicados. Caddy los sirve sin reiniciar (azure: https://erp.azure.localhost:8443 y https://portal.azure.localhost:8443).'
