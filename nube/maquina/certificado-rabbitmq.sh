#!/bin/sh
# 602 · Copia para RabbitMQ (AMQPS en 5671) el certificado de Let's Encrypt que Caddy saca para rabbitmq.<DOMINIO>:
# certificados/rabbitmq.crt (el del nombre), cadena.crt (los intermedios) y rabbitmq.key, con dueño 999 (el usuario
# rabbitmq de la imagen) y permisos 600. Si cambió y RabbitMQ corre, lo reinicia. Corre como root en vm-plataforma:
# al desplegar (con --esperar: espera hasta 10 min a que Caddy tenga el certificado), al encender y una vez al día
# (timer de cloud-init). En las otras máquinas no hace nada. Uso: certificado-rabbitmq.sh [--esperar]
set -eu
BASE=/opt/supervision/nube
COMPOSE="$BASE/compose.azure.yml"
[ -f "$COMPOSE" ] || exit 0
DOMINIO=$(sed -n "s/^DOMINIO=//p" "$BASE/.env" | head -n 1 | tr -d "'\"\r")
[ -n "$DOMINIO" ] || { echo "falta DOMINIO en $BASE/.env" >&2; exit 1; }
NOMBRE="rabbitmq.$DOMINIO"
limite=$(( $(date +%s) + 600 ))
while :; do
  crt=$(find "$BASE/datos/caddy/caddy/certificates" -name "$NOMBRE.crt" 2>/dev/null | head -n 1)
  [ -n "$crt" ] && break
  if [ "${1:-}" != "--esperar" ] || [ "$(date +%s)" -ge "$limite" ]; then
    echo "todavía no hay certificado para $NOMBRE: ¿el registro DNS apunta a esta máquina? (docker compose logs caddy)" >&2
    exit 1
  fi
  sleep 5
done
destino="$BASE/certificados"
install -d -m 0755 "$destino"
temporal=$(mktemp -d)
awk -v d="$temporal" '/BEGIN CERTIFICATE/ { n++ } { print > (n == 1 ? d "/rabbitmq.crt" : d "/cadena.crt") }' "$crt"
[ -s "$temporal/cadena.crt" ] || cp "$temporal/rabbitmq.crt" "$temporal/cadena.crt"
cp "${crt%.crt}.key" "$temporal/rabbitmq.key"
cambio=no
for archivo in rabbitmq.crt cadena.crt rabbitmq.key; do
  if ! cmp -s "$temporal/$archivo" "$destino/$archivo"; then
    install -m 0600 -o 999 -g 999 "$temporal/$archivo" "$destino/$archivo"
    cambio=si
  fi
done
rm -rf "$temporal"
if [ "$cambio" = si ] && [ -n "$(docker compose -f "$COMPOSE" ps -q rabbitmq 2>/dev/null)" ]; then
  docker compose -f "$COMPOSE" restart rabbitmq >/dev/null
  echo "certificado de $NOMBRE actualizado; RabbitMQ reiniciado"
else
  echo "certificado de $NOMBRE al día"
fi
