#!/bin/sh
# 201 y 010 · Pasa los secretos de .env a CREDENTIALS_OVERWRITE_DATA (las credenciales del repo no tienen secretos). n8n
# los pone en los campos vacíos de todas las credenciales de ese tipo cada vez que las usa. Lo usa iniciar.sh.
#   oAuth2Api  (Keycloak, cliente n8n)          clientSecret = N8N_KEYCLOAK_SECRETO
#   rabbitmq   (usuario n8n)                    password     = RABBITMQ_N8N_CLAVE
#   googleApi  (010, cuenta de servicio de FCM) email        = FIREBASE_CUENTA_CORREO (client_email de la clave JSON)
#                                               privateKey   = FIREBASE_CLAVE_PRIVADA (private_key, con sus \n)
#   googleApi solo va si están las dos variables de Firebase (sin ellas, los flujos de push no se publican).
#   smtp       (602, servidor de correo)        host, port, secure, disableStartTls, user y password desde SMTP_HOST,
#                                               SMTP_PUERTO, SMTP_SEGURO, SMTP_USUARIO y SMTP_CLAVE. Sin SMTP_HOST (o
#                                               con «mailpit»): Mailpit (mailpit:1025, sin TLS ni usuario). La
#                                               credencial del repo no trae estos campos: n8n solo llena los vacíos.
CREDENTIALS_OVERWRITE_DATA=$(node -e '
  const datos = {
    oAuth2Api: { clientSecret: process.env.N8N_KEYCLOAK_SECRETO },
    rabbitmq: { password: process.env.RABBITMQ_N8N_CLAVE },
  };
  const host = (process.env.SMTP_HOST || "").trim();
  datos.smtp = !host || host === "mailpit"
    ? { host: "mailpit", port: 1025, secure: false, disableStartTls: true, user: "", password: "" }
    : {
        host,
        port: Number(process.env.SMTP_PUERTO || 587),
        secure: (process.env.SMTP_SEGURO || "").toLowerCase() === "true",
        disableStartTls: false,
        user: process.env.SMTP_USUARIO || "",
        password: process.env.SMTP_CLAVE || "",
      };
  if (process.env.FIREBASE_CUENTA_CORREO && process.env.FIREBASE_CLAVE_PRIVADA) {
    datos.googleApi = { email: process.env.FIREBASE_CUENTA_CORREO, privateKey: process.env.FIREBASE_CLAVE_PRIVADA };
  }
  console.log(JSON.stringify(datos));
')
export CREDENTIALS_OVERWRITE_DATA
