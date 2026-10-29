# Contratos de `infra`

Lo que este repo deja listo para los demás proyectos. La fuente de los eventos es `docs/contratos/eventos.md` de la carpeta general; la de puertos y variables, `docs/entorno-local.md`.

## Puertos

| Pieza | Puerto |
|---|---|
| RabbitMQ (AMQP · panel) | 5672 · 15672 |
| Keycloak | 8080 (salud en el puerto de gestión 9000, solo dentro del contenedor) |
| PostgreSQL (perfil `bases`) | 5433 |
| MongoDB (perfil `bases`) | 27017 |

## RabbitMQ: usuarios

Un usuario por servicio, con permisos de configurar, escribir y leer en el vhost `/`. La contraseña de cada uno está en `.env` y se copia al `.env` del servicio.

| Usuario | Variable en `.env` | Lo usa |
|---|---|---|
| `obras` | `RABBITMQ_OBRAS_CLAVE` | services/obras (`OBRAS_RABBITMQ_USER` / `OBRAS_RABBITMQ_PASSWORD`) |
| `materiales` | `RABBITMQ_MATERIALES_CLAVE` | services/materiales (`RABBITMQ_URL`) |
| `finanzas` | `RABBITMQ_FINANZAS_CLAVE` | services/finanzas (`RABBITMQ_USER` / `RABBITMQ_PASSWORD`) |
| `ia` | `RABBITMQ_IA_CLAVE` | services/ia (capa 4, `IA_RABBITMQ_URL`) |
| `notificaciones` | `RABBITMQ_NOTIFICACIONES_CLAVE` | services/notificaciones (010, `RABBITMQ_URL`) |

El usuario `guest` de RabbitMQ solo entra desde dentro del contenedor: los servicios usan su propio usuario.

## MongoDB

*Replica set* de un nodo `rs0` con el miembro `localhost:27017`, en el contenedor (`mongo-init`) y en la instalación local (`scripts/mongo-local-replica.*`). Los servicios se conectan con `mongodb://localhost:27017/<base>?replicaSet=rs0`.

## Keycloak: realm `supervision`

Archivo `keycloak/realm-supervision.json`, importado al iniciar. Emisor: `http://localhost:8080/realms/supervision`.

- Roles del realm: `admin`, `residente`, `gerente`, `maestro`, `almacenero`, `cliente`.
- Todos los tokens llevan la audiencia `plataforma-api` (mapper de audiencia en cada cliente).
- Token de acceso: 5 minutos. Sesión SSO: 10 horas. Idioma: solo español. Tema de inicio de sesión: `supervision`.
- Contraseñas: mínimo 8 caracteres, 1 mayúscula, 1 número, distinta del usuario. Bloqueo temporal tras 5 intentos fallidos.

| Cliente | Tipo | Redirecciones | Uso |
|---|---|---|---|
| `erp` | público, PKCE S256 | `http://localhost:4200/*` | shell y microfrontends |
| `portal` | público, PKCE S256 | `http://localhost:4300/*` | portal del cliente |
| `app-obra` | público, PKCE S256 | `exp://*`, `appobra://*` | app de obra |
| `gateway` | confidencial, *service account* con `realm-management: view-users` | — | el gateway lee usuarios. Secreto **solo de desarrollo**: `gateway-secreto-solo-desarrollo` |

Usuarios de prueba (contraseña `Prueba123!`, no temporal): los 9 de `docs/datos-prueba.md` («Usuarios»), con su `id` fijo `a0000000-0000-4000-8000-0000000000NN`.

Para obtener el token de un usuario desde un script (flujo real con PKCE): `node pruebas/token-usuario.mjs residente1 [cliente] [redirect]`.
