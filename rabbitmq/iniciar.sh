#!/bin/sh
# Prepara RabbitMQ cada vez que se levanta el entorno (es idempotente) y termina:
#   1. importa definiciones.json (vhost, exchange plataforma, colas y enlaces) por la API del panel;
#   2. crea o actualiza un usuario por servicio con la contraseña de .env y permisos en el vhost "/".
# Las definiciones no se cargan al arrancar el servidor porque así RabbitMQ no crea el administrador de .env.
set -eu

api() {
  curl -fsS -u "$RABBITMQ_ADMIN_USUARIO:$RABBITMQ_ADMIN_CLAVE" -H 'content-type: application/json' -o /dev/null "$@"
}

api -X POST --data-binary @/definiciones.json "$RABBITMQ_URL/api/definitions"
echo "definiciones importadas"

crear() {
  usuario=$1
  clave=$2
  api -X PUT -d "{\"password\":\"$clave\",\"tags\":\"\"}" "$RABBITMQ_URL/api/users/$usuario"
  api -X PUT -d '{"configure":".*","write":".*","read":".*"}' "$RABBITMQ_URL/api/permissions/%2F/$usuario"
  echo "usuario $usuario listo"
}

crear obras "$RABBITMQ_OBRAS_CLAVE"
crear materiales "$RABBITMQ_MATERIALES_CLAVE"
crear finanzas "$RABBITMQ_FINANZAS_CLAVE"
crear ia "$RABBITMQ_IA_CLAVE"

# 201 · n8n solo consume sus colas (n8n.cobro-emitido y n8n.cobro-pagado, que ya declaran estas definiciones): no
# declara, no enlaza ni publica nada. Sin RABBITMQ_N8N_CLAVE (quien no usa el perfil automatizacion) no se crea.
if [ -n "${RABBITMQ_N8N_CLAVE:-}" ]; then
  api -X PUT -d "{\"password\":\"$RABBITMQ_N8N_CLAVE\",\"tags\":\"\"}" "$RABBITMQ_URL/api/users/n8n"
  api -X PUT -d '{"configure":"^$","write":"^$","read":"^n8n\\.cobro-(emitido|pagado)$"}' "$RABBITMQ_URL/api/permissions/%2F/n8n"
  echo "usuario n8n listo (solo lectura de n8n.cobro-emitido y n8n.cobro-pagado)"
fi
