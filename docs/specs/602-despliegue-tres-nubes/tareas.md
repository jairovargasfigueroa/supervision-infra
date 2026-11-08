# 602 · Despliegue en tres nubes · tareas de `infra`

Requisitos y diseño: `docs/specs/602-despliegue-tres-nubes/` de la carpeta que agrupa los proyectos (reescrita y aprobada el 08/11/2026). Las del APK están en las tareas de la 602 de app-obra.

Marca cada tarea al terminarla (con sus pruebas y su commit).

## Código (paso 1 del «Orden»)

- [x] (supervision-docs) Aplicar «Cambios a contratos y datos» del diseño
- [x] `nube/` base: `.env.example` con las variables de las tres nubes y sin secretos; `lib/comun.mjs` (lee el `.env`, tiene la lista de variables por nube y ejecuta comandos); `nube.mjs` con `secretos` (secretos al azar, hashes con las imágenes de n8n y Caddy, clave SSH) y `dns`; `.gitignore` con `nube/.env` y `nube/sitios/`
- [x] *Compose* de la nube (`compose.azure.yml`, `compose.aws.yml` y `compose.google.yml`), Caddyfiles con Let's Encrypt y nombres por variable, `rabbitmq/tls.conf`. El CI de infra valida los tres con `docker compose config -q` y un `.env` de ejemplo
- [x] n8n: credencial SMTP sin host, puerto ni usuario; `secretos.sh` los pasa desde `SMTP_*` (por defecto, Mailpit). En desarrollo siguen pasando `pruebas/cobranza.mjs` y `pruebas/avisos.mjs`
- [x] Realm: `CLIENTE1_CORREO` en el correo de `cliente1` (por defecto `cliente1@correo.test`); `contratos.md` lo anota
- [x] `maquina/cloud-init.yaml` (Docker Engine y Compose del repositorio oficial, *swap*, rotación de registros, usuario `supervision`, `/opt/supervision`, *timer* diario) y `maquina/certificado-rabbitmq.sh`
- [ ] `lib/aws.mjs`: `crear aws --datos` (bucket con CORS, las dos tablas, `obras-s3` con su clave en `.env`, rol `sincronizacion-ec2` y presupuesto) y `crear aws` (grupo de seguridad, par de claves, EC2 con IMDSv2 y límite de saltos 2, y Elastic IP). Además `encender`, `apagar` y `estado` en AWS
- [ ] `lib/azure.mjs`: `crear azure` (proveedores, cuota, grupo de recursos, NSG, IP, red, VM y presupuesto). Además `encender` (con la regla del 22 a la IP actual), `apagar` (desasignar) y `estado` en Azure
- [ ] `desplegar <nube>` (copia por `scp`, `.env` filtrado con permisos `600`, `pull`, Caddy primero, certificado de RabbitMQ y espera a que esté sano), `registros`, `ssh` y `contextos`
- [ ] `publicar-frontends.ps1` y `.sh`: opciones `--entorno` y `--destino`, y ajuste del `ngsw.json` con los remotos del entorno. `desplegar azure` lo usa
- [ ] Semilla: `SEMILLA_CONTEXTO_OBRAS`, `_FINANZAS` y `_MATERIALES` en `comun.ps1` y `comun.sh` (vacías = Docker local); `s3-cli` contra S3 real con `AWS_ENDPOINT_URL` vacío
- [ ] `humo-despliegue.mjs`: `--sin-google`, Mailpit con autenticación básica, el envío `NOTA_COBRO` en Finanzas cuando el SMTP no es Mailpit, y la comprobación de puertos cerrados
- [ ] `lib/google.mjs`: `crear google` (proyecto, API, *firewall*, IP, VM, `MONGO_IMAGEN` según `uname -r` y presupuesto), y `encender`, `apagar` y `estado` en Google
- [ ] `nube/README.md` (qué cambia respecto del ensayo local, comandos, pasos manuales de Jairo y costos); `CLAUDE.md` y `docs/contratos.md` de infra
- [ ] El ensayo local de la 601 sigue pasando completo: `levantar` y `humo-despliegue.mjs --completa`, 53 de 53

## Despliegue (pasos 2 a 7 del «Orden»)

- [ ] AWS, datos: `secretos` y `crear aws --datos`; comprobar el bucket, las tablas y que `obras-s3` puede subir a `fotos/` y no a otro prefijo
- [ ] Release `v1.0.0` en todos los repositorios; paquetes de GHCR públicos
- [ ] Azure: `crear azure`, registros DNS (Jairo), `desplegar azure` y `humo-despliegue.mjs --entorno nube/.env --sin-google` en verde
- [ ] AWS, máquina: `crear aws`, registro DNS (Jairo), `desplegar aws` y la prueba de humo con `--sin-google` en verde
- [ ] Google (cuando esté la cuenta): `crear google`, registros DNS, `desplegar google`, semilla de demostración, `ia-carga-inicial` y la prueba de humo con `--completa` en verde
- [ ] Firebase (cuando Jairo cree el proyecto): variables en `nube/.env`, `desplegar azure` y el aviso de stock bajo en el celular
- [ ] `apagar todas` y `estado` con las máquinas apagadas; marcar la 602 `hecho` en `docs/plan.md` cuando pasen las pruebas manuales de Jairo
