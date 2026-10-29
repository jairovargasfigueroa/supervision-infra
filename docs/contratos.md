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
