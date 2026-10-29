#!/bin/sh
# Crea o actualiza un usuario por servicio en RabbitMQ con la contraseña de .env, con permisos en el vhost "/".
# Lo ejecuta el servicio rabbitmq-usuarios del docker-compose cada vez que se levanta el entorno (es idempotente).
set -eu

crear() {
  usuario=$1
  clave=$2
  curl -fsS -u "$RABBITMQ_ADMIN_USUARIO:$RABBITMQ_ADMIN_CLAVE" -X PUT -H 'content-type: application/json' \
    -d "{\"password\":\"$clave\",\"tags\":\"\"}" "$RABBITMQ_URL/api/users/$usuario" -o /dev/null
  curl -fsS -u "$RABBITMQ_ADMIN_USUARIO:$RABBITMQ_ADMIN_CLAVE" -X PUT -H 'content-type: application/json' \
    -d '{"configure":".*","write":".*","read":".*"}' "$RABBITMQ_URL/api/permissions/%2F/$usuario" -o /dev/null
  echo "usuario $usuario listo"
}

crear obras "$RABBITMQ_OBRAS_CLAVE"
crear materiales "$RABBITMQ_MATERIALES_CLAVE"
crear finanzas "$RABBITMQ_FINANZAS_CLAVE"
crear ia "$RABBITMQ_IA_CLAVE"
crear notificaciones "$RABBITMQ_NOTIFICACIONES_CLAVE"
