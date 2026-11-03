#!/bin/sh
# 201 · Arranque del contenedor n8n (perfil automatizacion). Corre en cada arranque y es idempotente:
#   1. comprueba que .env tenga lo que necesita (si falta algo, se detiene y dice qué);
#   2. pasa los secretos de .env a CREDENTIALS_OVERWRITE_DATA (secretos.sh; las credenciales del repo no los tienen);
#   3. arranca el reenvío de localhost:8080 a Keycloak (mismo emisor de tokens que validan los servicios);
#   4. importa las credenciales y los flujos del repo (los flujos quedan desactivados) y publica cada flujo, salvo los
#      de push de la 010 si Firebase no está configurado (quedan importados sin publicar);
#   5. arranca n8n.
# El repo es la fuente: lo cambiado en el editor de n8n se pierde al reiniciar si no se exporta (README).
set -eu

falta=""
revisar() {
  eval "valor=\${$1:-}"
  [ -n "$valor" ] || falta="$falta $2"
}
revisar N8N_ENCRYPTION_KEY N8N_ENCRYPTION_KEY
revisar N8N_INSTANCE_OWNER_EMAIL N8N_PROPIETARIO_CORREO
revisar N8N_INSTANCE_OWNER_PASSWORD_HASH N8N_PROPIETARIO_CLAVE_HASH
revisar N8N_KEYCLOAK_SECRETO N8N_KEYCLOAK_SECRETO
revisar RABBITMQ_N8N_CLAVE RABBITMQ_N8N_CLAVE
if [ -n "$falta" ]; then
  echo "n8n no arranca: faltan en infra/.env:$falta (README de infra, «Cobranza automática: n8n y Mailpit»)." >&2
  exit 1
fi

. /n8n-config/secretos.sh

node /n8n-config/reenviar-keycloak.mjs &

# 010 · Los flujos de push («Avisar stock bajo» y «Recordar diario») necesitan Firebase: el id del proyecto y la cuenta
# de servicio. Sin las tres variables se importan pero no se publican (criterio 15); lo demás funciona igual.
FLUJOS_PUSH="avi010StockBajo0 avi010Diario0000"
firebase=si
for variable in FIREBASE_PROYECTO_ID FIREBASE_CUENTA_CORREO FIREBASE_CLAVE_PRIVADA; do
  eval "valor=\${$variable:-}"
  [ -n "$valor" ] || firebase=""
done
[ -n "$firebase" ] || echo "Firebase sin configurar (FIREBASE_PROYECTO_ID, FIREBASE_CUENTA_CORREO y FIREBASE_CLAVE_PRIVADA en infra/.env): los flujos de push quedan sin publicar (README de infra, «Avisos al celular y al cliente»)."

n8n import:credentials --separate --input=/n8n-config/credenciales
n8n import:workflow --separate --input=/n8n-config/flujos
for archivo in /n8n-config/flujos/*.json; do
  id=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).id)' "$archivo")
  case " $FLUJOS_PUSH " in
    *" $id "*) [ -n "$firebase" ] || { echo "flujo $id importado sin publicar (sin Firebase)"; continue; } ;;
  esac
  n8n publish:workflow --id="$id"
done

exec n8n start
