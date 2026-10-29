# Estructura de `infra`

Qué va en cada carpeta y cómo se agrega algo. Lo que corre, con versiones y puertos, está en `docs/entorno-local.md` de la carpeta general.

## Carpetas

| Ruta | Qué contiene | Cómo se cambia |
|---|---|---|
| `docker-compose.yml` | Un servicio por pieza, con imagen de versión fija, `healthcheck`, volumen con nombre (`datos-*`) y perfil cuando es opcional | Servicio nuevo → fila en `docs/entorno-local.md` y en `scripts/estado.*` |
| `.env.example` | Todas las variables con su valor de desarrollo; las contraseñas vacías | Variable nueva → aquí y en el `docker-compose.yml` |
| `postgres/init.sql` | Crea las bases de cada servicio en el contenedor (solo corre con el volumen vacío) | Base nueva → aquí y en `docs/convenciones.md` |
| `mongo/iniciar-replica.js` | `rs.initiate()` del *replica set* `rs0`; lo ejecuta el servicio `mongo-init` | — |
| `rabbitmq/definiciones.json` | Vhost `/`, exchange `plataforma`, colas durables y enlaces. **Sin usuarios** (sus contraseñas vienen de `.env`) | Enlace nuevo → aquí, en `docs/contratos.md` y en `pruebas/humo.mjs` |
| `rabbitmq/crear-usuarios.sh` | Crea (o actualiza) un usuario por servicio con la API del panel; lo ejecuta `rabbitmq-usuarios` | Servicio nuevo → su usuario aquí y su contraseña en `.env.example` |
| `keycloak/realm-supervision.json` | Realm `supervision` escrito a mano (no es una exportación completa): ajustes del realm, roles, clientes, usuarios de prueba | Cambiar aquí y reimportar con `scripts/reiniciar-datos.*` |
| `keycloak/temas/supervision/login/` | Tema de inicio de sesión: `theme.properties` (extiende `keycloak.v2`), CSS y logo | — |
| `scripts/` | Un `.ps1` y un `.sh` por acción, con el mismo comportamiento | Script nuevo → en los dos lenguajes y en el `CLAUDE.md` |
| `pruebas/humo.mjs` | Pruebas de humo con Node 24 (sin dependencias) contra el entorno levantado | Se amplía con cada pieza nueva |
| `docs/specs/NNN-nombre/tareas.md` | Tareas de `infra` de cada funcionalidad | — |

## Reglas

- Imágenes con versión exacta; nunca `latest`.
- Ningún secreto en el repo (excepto los fijados **solo para desarrollo** por la especificación: contraseña de los usuarios de prueba y secreto del cliente `gateway`).
- Archivos montados en contenedores con fin de línea LF (`.gitattributes`).
- Keycloak usa su propia base H2 dentro del contenedor, sin volumen: `bajar` y `reiniciar-datos` la borran y al levantar el realm se vuelve a importar del JSON (lo cambiado a mano en el panel se pierde).
