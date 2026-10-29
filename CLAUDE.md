# Infra (entorno de desarrollo)

Entorno de desarrollo de la plataforma: Docker Compose con RabbitMQ y Keycloak (y PostgreSQL y MongoDB como perfil opcional), el realm `supervision`, las definiciones de RabbitMQ y los scripts para levantar, ver el estado y reiniciar todo. Más adelante, la carga de datos de prueba (011) y las pruebas de punta a punta.

Parte de la «Plataforma de supervisión de obras». Si existe `../CLAUDE.md` (carpeta que agrupa todos los proyectos), léelo primero: tiene las reglas transversales, el plan y los contratos generales. Lo que corre aquí, sus versiones y puertos están en `docs/entorno-local.md` de esa carpeta: **es la fuente; si algo cambia, se actualiza allí también.**

**Estado:** fase 1 (entorno y esqueleto que camina).

## Stack

- Docker Compose (Docker Desktop con WSL 2)
- Imágenes con versión fija: `rabbitmq:4.4-management`, `quay.io/keycloak/keycloak:26.8.1`, `postgres:17`, `mongo:8.0`, `curlimages/curl:8.17.0` (solo para importar las definiciones y crear los usuarios de RabbitMQ al iniciar)
- Scripts en PowerShell (`.ps1`, Windows) y Bash (`.sh`, Linux y macOS) que hacen lo mismo
- Pruebas de humo con Node 24 (`node pruebas/humo.mjs`, sin dependencias)

## Comandos

```sh
cp .env.example .env              # una vez; completa las contraseñas
./scripts/levantar.ps1            # RabbitMQ y Keycloak (agrega -Perfil bases para PostgreSQL y MongoDB)
./scripts/estado.ps1              # qué contenedor está sano y GET /salud de cada servicio que corre
./scripts/bajar.ps1               # detiene todo (conserva los datos)
./scripts/reiniciar-datos.ps1     # borra los volúmenes y levanta todo vacío (pide confirmación)
./scripts/mongo-local-replica.ps1 # una vez, como administrador: MongoDB instalado en Windows como replica set rs0
node pruebas/humo.mjs             # comprueba realm, colas y enlaces contra lo que está corriendo
docker compose config -q          # valida el docker-compose.yml
```

En Linux y macOS, los mismos scripts con `.sh` (`--perfil bases`).

**`.env` nunca se sube.** Las contraseñas de desarrollo se fijan una vez en `.env` y se copian a los `.env` de cada proyecto.

## Estructura

```
docker-compose.yml        servicios, perfiles, healthchecks y volúmenes con nombre
.env.example              variables (contraseñas vacías, SEMILLA_PERMITIDA)
postgres/init.sql         bases obras_db y finanzas_db (perfil bases)
mongo/iniciar-replica.js  rs.initiate() del replica set rs0 (perfil bases)
rabbitmq/
  definiciones.json       vhost, exchange plataforma, colas y enlaces (sin usuarios)
  iniciar.sh              importa las definiciones y crea los usuarios por servicio desde .env (API del panel)
keycloak/
  realm-supervision.json  realm importado al iniciar (roles, clientes, usuarios de prueba)
  temas/supervision/      tema de la pantalla de inicio de sesión (extiende keycloak.v2)
scripts/                  levantar, estado, bajar, reiniciar-datos y mongo-local-replica (.ps1 y .sh)
pruebas/humo.mjs          pruebas de humo del entorno levantado
docs/                     estructura, contratos y tareas por funcionalidad
```

## Reglas del proyecto

- Versiones de imágenes fijas (nunca `latest`); se cambian en `docs/entorno-local.md` y aquí a la vez.
- Ninguna contraseña en el repo, salvo las que la especificación fija **solo para desarrollo**: la de los usuarios de prueba (`Prueba123!`) y el secreto del cliente `gateway` en el realm.
- Las colas y enlaces de RabbitMQ siguen `docs/contratos/eventos.md` de la carpeta general (y las specs que agregan colas). Un enlace nuevo se agrega en `rabbitmq/definiciones.json`, en `docs/contratos.md` y en `pruebas/humo.mjs`.
- Los cambios al realm se hacen en `keycloak/realm-supervision.json` y se comprueban con `./scripts/reiniciar-datos.ps1` (Keycloak solo importa un realm que no existe).
- Los archivos montados en contenedores (`.sh`, `.conf`, `.json`, `.js`) van con fin de línea LF (`.gitattributes`).

## Documentación

- `docs/estructura.md`: **qué va en cada carpeta y cómo agregar algo. Obligatorio leerlo antes de cambiar el entorno.**
- `docs/contratos.md`: lo que este repo deja listo para los demás (realm, clientes, colas, enlaces, usuarios, puertos).
- `docs/specs/NNN-nombre/tareas.md`: tareas de `infra` de cada funcionalidad.

## Commits

Conventional Commits en español e imperativo (`feat(keycloak): agrega usuarios de prueba`). Sin coautoría ni firmas de la IA.

Git Flow: ramas `feat/`, `fix/`, `docs/`… desde `develop`, que entran por *pull request*; nunca hagas *push* a `main` ni a `develop` (están protegidas). El agente crea y fusiona los PR (merge normal, sin squash) hacia `develop` cuando todas las pruebas pasan. Detalle y definición de terminado: `docs/flujo-trabajo.md` del repo `supervision-docs`.
