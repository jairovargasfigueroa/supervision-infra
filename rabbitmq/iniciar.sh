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
crear notificaciones "$RABBITMQ_NOTIFICACIONES_CLAVE"
