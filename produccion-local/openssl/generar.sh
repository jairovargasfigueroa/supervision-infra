#!/bin/sh
# 601 · Corre dentro de un contenedor con OpenSSL 3 (la imagen de RabbitMQ, que ya está en la máquina) y deja en
# /certificados (produccion-local/certificados, fuera del repositorio):
#   ca.key, ca.crt     autoridad certificadora local del ensayo (la usan los tres Caddy para firmar sus certificados)
#   rabbitmq.key/.crt  certificado de RabbitMQ (AMQPS 5671) para rabbitmq.azure.localhost, firmado por la CA
#   ca.p12             la CA como truststore PKCS12 de Java (Obras: JAVA_TOOL_OPTIONS), contraseña «changeit»
# Idempotente: no pisa la CA ni el certificado de RabbitMQ si ya existen (para cambiarlos, bórralos antes).
set -eu
cd /certificados

if [ ! -f ca.key ] || [ ! -f ca.crt ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -sha256 -days 825 -nodes \
    -keyout ca.key -out ca.crt -subj "/O=Supervision de obras/CN=Supervision produccion local CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
  rm -f rabbitmq.key rabbitmq.crt
  echo "CA local creada (ca.crt)"
else
  echo "CA local ya existe (ca.crt)"
fi

if [ ! -f rabbitmq.key ] || [ ! -f rabbitmq.crt ]; then
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout rabbitmq.key -out rabbitmq.csr \
    -subj "/O=Supervision de obras/CN=rabbitmq.azure.localhost"
  cat > rabbitmq.ext <<'EXT'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:rabbitmq.azure.localhost,DNS:rabbitmq,DNS:localhost
EXT
  openssl x509 -req -in rabbitmq.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 397 -sha256 \
    -extfile rabbitmq.ext -out rabbitmq.crt
  rm -f rabbitmq.csr rabbitmq.ext ca.srl
  echo "certificado de RabbitMQ creado (rabbitmq.azure.localhost)"
else
  echo "certificado de RabbitMQ ya existe"
fi

# Truststore de Java: -jdktrust marca la CA como confiable para Java (OpenSSL 3.2 o más)
openssl pkcs12 -export -nokeys -in ca.crt -out ca.p12 -name ca-local -jdktrust anyExtendedKeyUsage -passout pass:changeit
# Las claves las leen RabbitMQ (usuario 999) y Caddy desde el montaje: es una CA desechable, solo para la laptop
chmod 644 ca.crt ca.key ca.p12 rabbitmq.crt rabbitmq.key
openssl verify -CAfile ca.crt rabbitmq.crt
