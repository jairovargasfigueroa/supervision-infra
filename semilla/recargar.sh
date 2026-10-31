#!/usr/bin/env bash
# Vacía los datos de desarrollo y vuelve a cargar los datos de prueba (011) con la fecha del día.
# Vacía Finanzas y Materiales con sus comandos, las colas de la plataforma en RabbitMQ, la base de reportes de IA
# (401) y las fotos del bucket (prefijo fotos/); reimporta el realm si los usuarios no tienen su id; carga con Obras
# en modo recargar (Obras vacía sus tablas en la misma transacción en que carga) y pide correr la carga inicial de
# la base de reportes. Se recomienda detener antes los servicios.
# Uso: ./semilla/recargar.sh [--si]     (--si omite la confirmación)
. "$(dirname "$0")/comun.sh"

SI=no
for argumento in "$@"; do
  case "$argumento" in
    --si) SI=si ;;
    *) detener "Opción desconocida: $argumento (uso: ./semilla/recargar.sh [--si])" ;;
  esac
done

comprobar_entorno --rabbitmq
node "$AYUDANTE" servicios

if [ "$SI" != si ]; then
  bucket=''
  [ "$FOTOS" = si ] && bucket=" y las fotos de s3://$BUCKET/fotos/"
  echo
  read -r -p "Esto borra todos los datos de desarrollo de obras_db, finanzas_db, materiales_db, reportes_db, las colas de RabbitMQ de la plataforma$bucket. ¿Continuar? (s/N) " respuesta
  if [ "$respuesta" != s ] && [ "$respuesta" != S ]; then echo 'Cancelado: no se borró nada.'; exit 0; fi
fi

paso 'Vaciar Finanzas (datos-prueba:vaciar)'
ejecutar Finanzas "$FINANZAS_DIR" php artisan datos-prueba:vaciar

paso 'Vaciar Materiales (npm run semilla:vaciar)'
ejecutar Materiales "$MATERIALES_DIR" npm run semilla:vaciar

paso 'Vaciar las colas de la plataforma (RabbitMQ)'
node "$AYUDANTE" colas || exit 1

paso 'Vaciar la base de reportes de IA (reportes_db, 401)'
vaciar_reportes

paso 'Borrar las fotos del bucket S3 de desarrollo'
if [ "$FOTOS" = si ]; then
  ejecutar_s3 s3 rm "s3://$BUCKET/fotos/" --recursive --only-show-errors \
    || detener "No se pudieron borrar las fotos de s3://$BUCKET/fotos/ (salida de arriba)."
  echo "ok       s3://$BUCKET/fotos/ vacío"
else
  aviso 'Fotos saltadas (sin bucket o sin claves en infra/.env).'
fi

paso 'Keycloak: usuarios con su id fijo'
node "$AYUDANTE" usuarios
codigo=$?
if [ "$codigo" -eq 3 ]; then
  echo 'Se reimporta el realm (se recrea el contenedor de Keycloak; lo cambiado a mano en el panel se pierde).'
  (cd "$INFRA" && docker compose up -d --force-recreate keycloak) || detener 'No se pudo recrear Keycloak (salida de arriba).'
  node "$AYUDANTE" esperar-keycloak || exit 1
  node "$AYUDANTE" usuarios
  codigo=$?
fi
[ "$codigo" -eq 0 ] || detener 'Los usuarios de Keycloak siguen sin coincidir con docs/datos-prueba.md: revisa keycloak/realm-supervision.json.'

cargar_datos recargar

paso 'Base de reportes (401): falta la carga inicial'
if [ "$REPORTES" = si ]; then
  echo 'reportes_db quedó vacía. Con Obras, Materiales y Finanzas levantados, corre la carga inicial del servicio de IA:'
else
  echo 'Cuando el servicio de IA tenga su base, con Obras, Materiales y Finanzas levantados, corre la carga inicial:'
fi
echo '  docker compose --profile ia-carga run --rm ia-carga-inicial     (en infra)'
echo '  o, en services/ia: uv run python -m ia.carga_inicial'
