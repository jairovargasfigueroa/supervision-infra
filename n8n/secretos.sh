#!/bin/sh
# 201 · Pasa los secretos de .env a CREDENTIALS_OVERWRITE_DATA (las credenciales del repo no tienen secretos). n8n
# los aplica a todas las credenciales de ese tipo cada vez que las usa. Lo usan iniciar.sh y ejecutar-flujo.sh.
CREDENTIALS_OVERWRITE_DATA=$(node -e '
  console.log(JSON.stringify({
    oAuth2Api: { clientSecret: process.env.N8N_KEYCLOAK_SECRETO },
    rabbitmq: { password: process.env.RABBITMQ_N8N_CLAVE },
  }));
')
export CREDENTIALS_OVERWRITE_DATA
