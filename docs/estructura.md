# Estructura de `infra`

Qué va en cada carpeta y cómo se agrega algo. Lo que corre, con versiones y puertos, está en `docs/entorno-local.md` de la carpeta general.

## Carpetas

| Ruta | Qué contiene | Cómo se cambia |
|---|---|---|
| `docker-compose.yml` | Un servicio por pieza, con imagen de versión fija, `healthcheck`, volumen con nombre (`datos-*`) y perfil cuando es opcional | Servicio nuevo → fila en `docs/entorno-local.md` y en `scripts/estado.*` |
| `docker-compose.yml` → `s3-cli` | AWS CLI (`amazon/aws-cli:2.38.0`, perfil `herramientas`) con `semilla/fotos` de solo lectura y las claves del usuario IAM de desarrollo de `.env`. Es una herramienta de una sola vez (sin *healthcheck*): se usa con `docker compose --profile herramientas run --rm s3-cli s3 …` | Solo la llaman los scripts de `semilla/` |
| `.env.example` | Todas las variables con su valor de desarrollo; las contraseñas y claves vacías | Variable nueva → aquí y en el `docker-compose.yml` |
| `postgres/init.sql` | Crea las bases de cada servicio en el contenedor (solo corre con el volumen vacío) | Base nueva → aquí y en `docs/convenciones.md` |
| `postgres/init-reportes.sh` | 401: usuario `ia` (contraseña `POSTGRES_IA_CLAVE` de `.env`) y base `reportes_db`, dueña de ese usuario; corre después de `init.sql` (se montan como `01-bases.sql` y `02-reportes.sh`) | Un servicio con usuario propio → un script así |
| `mongo/iniciar-replica.js` | `rs.initiate()` del *replica set* `rs0`; lo ejecuta el servicio `mongo-init` | — |
| `rabbitmq/definiciones.json` | Vhost `/`, exchange `plataforma`, colas durables y enlaces. **Sin usuarios** (sus contraseñas vienen de `.env`) | Enlace nuevo → aquí, en `docs/contratos.md` y en `pruebas/humo.mjs` |
| `rabbitmq/iniciar.sh` | Importa `definiciones.json` y crea (o actualiza) un usuario por servicio con la API del panel; lo ejecuta `rabbitmq-init` al levantar | Servicio nuevo → su usuario aquí y su contraseña en `.env.example` |
| `keycloak/realm-supervision.json` | Realm `supervision` escrito a mano (no es una exportación completa): ajustes del realm, roles, clientes, usuarios de prueba | Cambiar aquí y reimportar con `scripts/reiniciar-datos.*` |
| `keycloak/temas/supervision/login/` | Tema de inicio de sesión: `theme.properties` (extiende `keycloak.v2`), CSS y logo | — |
| `scripts/` | Un `.ps1` y un `.sh` por acción, con el mismo comportamiento | Script nuevo → en los dos lenguajes y en el `CLAUDE.md` |
| `semilla/semilla.ps1` · `.sh` | Carga los datos de prueba (011): guardas, piezas que responden, D en `SEMILLA_FECHA`, usuarios de Keycloak, Obras → Finanzas → Materiales (cada uno con su comando), fotos al bucket y resumen | Una capa que amplía la semilla agrega su paso en `comun.ps1` y `comun.sh` |
| `semilla/recargar.ps1` · `.sh` | Vacía y vuelve a cargar (pide confirmación; `-Si` / `--si`) | Ídem |
| `semilla/comun.ps1` · `comun.sh` | Los pasos que comparten `semilla` y `recargar`, uno por lenguaje con el mismo comportamiento | Cambiar los dos a la vez |
| `semilla/plataforma.mjs` | Lo que se habla por HTTP o TCP (fecha D, piezas que responden, usuarios de Keycloak, colas de RabbitMQ), común a los dos lenguajes; Node 24 sin dependencias | — |
| `semilla/fotos/` | `generar-fotos.ps1` (System.Drawing) y las 10 fotos generadas en `{obraId}/{fotoId}.jpg` (sección 10 de `docs/datos-prueba.md`) | Foto nueva → en el script, se vuelve a correr y se sube la imagen |
| `pruebas/humo.mjs` | Pruebas de humo con Node 24 (sin dependencias) contra el entorno levantado | Se amplía con cada pieza nueva |
| `pruebas/saga.mjs` | Prueba de punta a punta de la saga «aprobar planilla» (008) contra los servicios corriendo; crea una obra y aprueba su planilla | Se ejecuta a mano (README) |
| `pruebas/token-usuario.mjs` | Token de un usuario de prueba con el flujo real del navegador (código + PKCE) | Lo usan las pruebas de punta a punta |
| `docs/specs/NNN-nombre/tareas.md` | Tareas de `infra` de cada funcionalidad | — |

## Reglas

- Imágenes con versión exacta; nunca `latest`.
- Ningún secreto en el repo (excepto los fijados **solo para desarrollo** por la especificación: contraseña de los usuarios de prueba y secreto del cliente `gateway`).
- Archivos montados en contenedores con fin de línea LF (`.gitattributes`).
- Keycloak usa su propia base H2 dentro del contenedor, sin volumen: `bajar` y `reiniciar-datos` la borran y al levantar el realm se vuelve a importar del JSON (lo cambiado a mano en el panel se pierde).
