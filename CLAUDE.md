# Infra (entorno de desarrollo)

Entorno de desarrollo de la plataforma: Docker Compose con RabbitMQ, Keycloak y DynamoDB Local (y PostgreSQL y MongoDB como perfil opcional), el realm `supervision`, las definiciones de RabbitMQ y los scripts para levantar, ver el estado y reiniciar todo, la carga de los datos de prueba (011, carpeta `semilla/`), la automatización de cobranza y los avisos con n8n y Mailpit (201 y 010, perfil `automatizacion`; *push* por Firebase Cloud Messaging) y las pruebas de punta a punta.

Parte de la «Plataforma de supervisión de obras». Si existe `../CLAUDE.md` (carpeta que agrupa todos los proyectos), léelo primero: tiene las reglas transversales, el plan y los contratos generales. Lo que corre aquí, sus versiones y puertos están en `docs/entorno-local.md` de esa carpeta: **es la fuente; si algo cambia, se actualiza allí también.**

**Estado:** fase 1 (entorno y esqueleto que camina).

## Stack

- Docker Compose (Docker Desktop con WSL 2)
- Imágenes con versión fija: `rabbitmq:4.4-management`, `quay.io/keycloak/keycloak:26.8.1`, `postgres:17`, `mongo:8.0`, `amazon/dynamodb-local:3.3.2` (Sincronización, 101), `curlimages/curl:8.17.0` (solo para importar las definiciones y crear los usuarios de RabbitMQ al iniciar), `amazon/aws-cli:2.38.0` (servicio `s3-cli`, perfil `herramientas`: sube y borra las fotos de prueba en el bucket S3 de desarrollo), `ollama/ollama:0.40.4` (perfil `ollama`, 503: modelo de lenguaje local; GPU opcional con `docker-compose.gpu.yml`), `n8nio/n8n:2.43.7` y `axllent/mailpit:v1.31.6` (perfil `automatizacion`, 201 y 010: flujos de cobranza y de avisos, y buzón de correo de prueba)
- «Producción local» (601, carpeta `produccion-local/`): los mismos `rabbitmq`, `keycloak` (ahora con `start` y PostgreSQL), `postgres`, `mongo`, `dynamodb-local`, `n8n`, `mailpit`, `ollama` y `aws-cli`, más `caddy:2.11.7-alpine` (HTTPS con una CA local y los frontends estáticos) y `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` (S3 compatible: el MinIO oficial ya no publica imágenes en Docker Hub; es su *fork* comunitario), y las imágenes de producción de los 6 servicios
- Scripts en PowerShell (`.ps1`, Windows) y Bash (`.sh`, Linux y macOS) que hacen lo mismo
- Nube (602, carpeta `nube/`): una máquina por nube (Ubuntu 24.04, Docker Engine) con los *compose* de `nube/`, Caddy con Let's Encrypt y `nube.mjs` (Node 24, sin dependencias) que llama a `az`, `aws`, `gcloud`, `ssh`, `scp`, `tar` y `docker`
- Pruebas de humo con Node 24 (`node pruebas/humo.mjs`, sin dependencias)

## Comandos

```sh
cp .env.example .env              # una vez; completa las contraseñas
./scripts/levantar.ps1            # RabbitMQ, Keycloak y DynamoDB Local (agrega -Perfil bases para PostgreSQL y MongoDB)
docker compose --profile ia up -d --build   # 401: ia-api (8085) e ia-worker desde la imagen de services/ia (opcional)
docker compose --profile ia-carga run --rm ia-carga-inicial   # 401: carga inicial de reportes_db (una vez, y después de recargar)
docker compose --profile ollama up -d ollama   # 503: modelo de lenguaje local (con GPU: agrega -f docker-compose.yml -f docker-compose.gpu.yml)
./scripts/descargar-modelo.ps1    # 503: ollama pull qwen3:8b (o IA_LLM_MODELO) en el servicio ollama; una vez
./scripts/estado.ps1              # qué contenedor está sano y GET /salud de cada servicio que corre
./scripts/bajar.ps1               # detiene todo (conserva los datos)
./scripts/reiniciar-datos.ps1     # borra los volúmenes y levanta todo vacío (pide confirmación)
./scripts/mongo-local-replica.ps1 # una vez, como administrador: MongoDB instalado en Windows como replica set rs0
./scripts/celular.ps1             # adb reverse para probar la app en el celular (8080, 8081, 8082, 8084 y Metro 8090)
node pruebas/humo.mjs             # comprueba realm (con la sesión offline de la app), colas, enlaces y DynamoDB Local contra lo que está corriendo
node pruebas/saga.mjs             # saga «aprobar planilla» de punta a punta (008; con los servicios corriendo)
node pruebas/reportes.mjs [--carga]  # base de reportes (401): eventos y carga inicial (con los servicios y el de IA corriendo)
./scripts/levantar.ps1 -Perfil automatizacion   # 201 y 010: además n8n (5678) y Mailpit (8025); variables y Firebase en el README
node pruebas/cobranza.mjs         # 201: cobranza automática de punta a punta (con los servicios, n8n y Mailpit)
node pruebas/avisos.mjs           # 010: correo «Planilla para revisar» en Mailpit y sin repetidos (con Obras, n8n y Mailpit)
./semilla/semilla.ps1             # carga los datos de prueba (011); idempotente; SEMILLA_FECHA fija la fecha D
./semilla/recargar.ps1 [-Si]      # vacía y vuelve a cargar los datos de prueba con la fecha del día (pide confirmación)
node semilla/eventos-ia.mjs [--entorno nube/.env]   # 503: eventos de prueba para IA (consumos atípicos), después de la carga inicial y con ia-worker
node semilla/agentes.mjs [--entorno nube/.env]      # 502: entradas del diario de prueba (Obras, como maestro1) y comprobación del escenario de los agentes
docker compose config -q          # valida el docker-compose.yml
./produccion-local/levantar.ps1 [-Grupo azure|google|aws] [-DesdeGhcr]   # 601: ensayo con imágenes de producción (README)
./produccion-local/bajar.ps1 [-Grupo …] [-Datos]                         # 601: lo baja (con -Datos borra sus volúmenes)
./semilla/semilla.ps1 -Entorno produccion-local/.env                     # 601: datos de demostración (SEMILLA_DEMO=si)
node pruebas/humo-despliegue.mjs --entorno produccion-local/.env [--completa]   # 601: prueba de humo del despliegue
node nube/nube.mjs secretos | crear <nube> | desplegar <nube> | encender todas | apagar todas | estado   # 602 (nube/README.md)
node pruebas/humo-despliegue.mjs --entorno nube/.env [--sin-google | --completa]   # 602: prueba de humo en la nube
node pruebas/banco-ia.mjs --entorno nube/.env [--muestra] [--agentes]   # 505: banco de preguntas y agentes (gasta saldo del modelo)
```

En Linux y macOS, los mismos scripts con `.sh` (`--perfil bases`).

**`.env` nunca se sube.** Las contraseñas de desarrollo se fijan una vez en `.env` y se copian a los `.env` de cada proyecto.

## Estructura

```
docker-compose.yml        servicios, perfiles, healthchecks y volúmenes con nombre
docker-compose.gpu.yml    503: opcional, da la GPU NVIDIA al servicio ollama
.env.example              variables (contraseñas y claves vacías, SEMILLA_PERMITIDA, carpetas de los servicios, bucket S3)
postgres/init.sql         bases obras_db y finanzas_db (perfil bases)
postgres/init-reportes.sh usuario ia y base reportes_db, dueña de ia (401; contraseña POSTGRES_IA_CLAVE de .env)
postgres/vaciar-reportes.sql vacía el modelo de lectura en recargar (401; lo corre el servicio psql-cli)
mongo/iniciar-replica.js  rs.initiate() del replica set rs0 (perfil bases)
mongo/vaciar-ia.js        503: vacía ia_db.consumo_atipico en recargar (lo corre el servicio mongo-cli)
ia/reenviar-keycloak.py   401: dentro de los contenedores de IA, localhost:8080 → keycloak:8080 (mismo emisor de tokens)
n8n/                      201 y 010 (perfil automatizacion): iniciar.sh, secretos.sh, reenviar-keycloak.mjs, flujos/ y credenciales/ (sin secretos)
rabbitmq/
  definiciones.json       vhost, exchange plataforma, colas y enlaces (sin usuarios)
  iniciar.sh              importa las definiciones y crea los usuarios por servicio desde .env (API del panel)
keycloak/
  realm-supervision.json  realm importado al iniciar (roles, clientes, usuarios de prueba)
  temas/supervision/      tema de la pantalla de inicio de sesión (extiende keycloak.v2)
scripts/                  levantar, estado, bajar, reiniciar-datos, mongo-local-replica, celular y descargar-modelo (.ps1 y .sh)
pruebas/humo.mjs          pruebas de humo del entorno levantado
pruebas/saga.mjs          prueba de punta a punta de la saga (008)
pruebas/reportes.mjs      prueba de integración de la base de reportes (401): eventos y carga inicial
pruebas/cobranza.mjs      prueba de punta a punta de la cobranza automática (201): correos en Mailpit y envíos en Finanzas
pruebas/avisos.mjs        prueba del correo «Planilla para revisar» (010): Mailpit y avisos repetidos
semilla/
  semilla.ps1 · .sh       carga los datos de prueba (011): guardas, D, Keycloak, Obras → Finanzas → Materiales, fotos, resumen
  recargar.ps1 · .sh      vacía (servicios, colas, reportes_db, bucket) y vuelve a cargar; pide la carga inicial (401)
  comun.ps1 · comun.sh    pasos comunes de los dos scripts (uno por lenguaje, mismo comportamiento)
  plataforma.mjs          fecha D, piezas que responden, usuarios de Keycloak y colas (Node 24, lo usan los dos lenguajes)
  eventos-ia.mjs          503: vuelve a publicar en la cola ia el MovimientoRegistrado de las salidas 10033 y 20018
  agentes.mjs             502: diario de obra de prueba por la API de Obras y comprobación del escenario de los agentes
  entorno-script.mjs      602: entorno de eventos-ia.mjs y agentes.mjs (infra/.env o --entorno con SEMILLA_DEMO=si)
  fotos/                  generar-fotos.ps1 y las 10 fotos en {obraId}/{fotoId}.jpg
produccion-local/         601: ensayo con imágenes de producción en tres grupos (compose.azure|google|aws.yml, caddy/,
                          certificados, publicar-frontends, levantar y bajar; README «Producción local»)
pruebas/humo-despliegue.mjs  601: prueba de humo de un despliegue (producción local o nube) con --entorno, --completa y --sin-google
pruebas/banco-ia.mjs     505: banco de preguntas del asistente de reportes y ejecución de los agentes contra un despliegue
nube/                     602: compose.azure|google|aws.yml, caddy/, rabbitmq/tls.conf, maquina/ (cloud-init y certificado de
                          RabbitMQ), nube.mjs y lib/; .env y sitios/ fuera del repo (nube/README.md)
.github/workflows/ci.yml  601: valida los compose, el realm, las definiciones y los flujos en cada pull request
docs/                     estructura, contratos y tareas por funcionalidad
```

## Reglas del proyecto

- **Datos de prueba solo en desarrollo:** `semilla` y `recargar` se niegan sin `SEMILLA_PERMITIDA=si` en `.env` y con un `S3_BUCKET` que no empiece con `supervision-dev-`. No los corras contra bases con datos que quieras conservar (`recargar` las vacía). Lo que espera infra de cada servicio está en `docs/contratos.md` («Datos de prueba»). **Única excepción (601):** `semilla -Entorno <archivo>` con `SEMILLA_DEMO=si` en ese archivo carga los datos de demostración en la «producción local» o en la nube, y `semilla/eventos-ia.mjs` y `semilla/agentes.mjs` con `--entorno <archivo>` completan su escenario (602: solo agregan, con ids fijos); `recargar` nunca corre con `SEMILLA_DEMO=si`. Para dejar limpios los datos de la nube: `nube/README.md`, «Volver a dejar los datos de demostración limpios».
- **La nube (602)** se maneja solo con `nube/nube.mjs`; `nube/.env` (secretos de producción) nunca se sube y Jairo guarda una copia. Los *scripts* de `nube/` son de Node (no `.ps1` y `.sh`) porque llaman a CLI que corren igual en los dos sistemas.
- **La «producción local» no toca el desarrollo:** proyectos de Compose `supervision-azure`, `supervision-google` y `supervision-aws`, con sus propias redes, volúmenes y puertos (8443, 9443, 10443 y 5671); nunca bajes ni recrees el proyecto `supervision` desde sus scripts. Solo comparte, en modo lectura, el volumen del modelo de Ollama.
- Versiones de imágenes fijas (nunca `latest`); se cambian en `docs/entorno-local.md` y aquí a la vez.
- Ninguna contraseña en el repo, salvo las que la especificación fija **solo para desarrollo**: la de los usuarios de prueba (`Prueba123!`) y el secreto del cliente `gateway` en el realm. El secreto de `ia-reportes` (401) va en `.env` y el realm lo toma al importar (`${IA_REPORTES_CLIENT_SECRET}`); igual el de `ia-agentes` (501, `${IA_AGENTES_CLIENT_SECRET}`) y el de `n8n` (201, `${N8N_KEYCLOAK_SECRETO}`; si falta, Keycloak le pone uno al azar). Las credenciales de n8n se guardan sin secretos y los reciben por `CREDENTIALS_OVERWRITE_DATA` (también la cuenta de servicio de Firebase, 010).
- Las variables nuevas de un perfil opcional van con valor por defecto vacío (`${VAR:-}`): ningún perfil puede romper `docker compose` de los demás.
- Las colas y enlaces de RabbitMQ siguen `docs/contratos/eventos.md` de la carpeta general (y las specs que agregan colas). Un enlace nuevo se agrega en `rabbitmq/definiciones.json`, en `docs/contratos.md` y en `pruebas/humo.mjs`.
- Los cambios al realm se hacen en `keycloak/realm-supervision.json` y se comprueban con `./scripts/reiniciar-datos.ps1` (Keycloak solo importa un realm que no existe). Lo que cambia según el entorno va como `${VARIABLE:valor de desarrollo}` (601: `ERP_URL`, `PORTAL_URL`, `USUARIOS_PRUEBA_CLAVE`, `KEYCLOAK_GATEWAY_CLIENT_SECRET`; `docs/contratos.md`).
- Los archivos montados en contenedores (`.sh`, `.conf`, `.json`, `.js`) van con fin de línea LF (`.gitattributes`).

## Documentación

- `docs/estructura.md`: **qué va en cada carpeta y cómo agregar algo. Obligatorio leerlo antes de cambiar el entorno.**
- `docs/contratos.md`: lo que este repo deja listo para los demás (realm, clientes, colas, enlaces, usuarios, puertos).
- `docs/specs/NNN-nombre/tareas.md`: tareas de `infra` de cada funcionalidad.

## Commits

Conventional Commits en español e imperativo (`feat(keycloak): agrega usuarios de prueba`). Sin coautoría ni firmas de la IA.

Git Flow: ramas `feat/`, `fix/`, `docs/`… desde `develop`, que entran por *pull request*; nunca hagas *push* a `main` ni a `develop` (están protegidas). El agente crea y fusiona los PR (merge normal, sin squash) hacia `develop` cuando todas las pruebas pasan. Detalle y definición de terminado: `docs/flujo-trabajo.md` del repo `supervision-docs`.
