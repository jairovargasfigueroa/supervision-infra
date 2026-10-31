# 401 · Servicio de IA y base de reportes · tareas de `infra`

Requisitos y diseño: `docs/specs/401-base-reportes/` de esta carpeta. Contratos: `docs/contratos.md` de este proyecto.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] Base `reportes_db` y usuario `ia` en el script de inicio de PostgreSQL (y nota en el README para la instalación local en el puerto 5433)
- [x] Comprobar que las definiciones de RabbitMQ de la fase 1 traen la cola durable `ia` con sus 6 enlaces y la cola `plataforma.fallidos` (agregar lo que falte); comprobar en el panel que los eventos se acumulan con el servicio de IA apagado
- [x] Servicios opcionales `ia-api` (8085) e `ia-worker` en Docker Compose, construidos desde `services/ia`
- [ ] Prueba de integración: registrar obra y aprobar planilla con Docker Compose y comprobar las filas en `reportes_db` (script documentado en el README)

Agregadas al aprobar la spec (31/10/2026; diseño, «Carga inicial» e «Infra»):

- [ ] Cliente confidencial `ia-reportes` en el realm (solo *service account*: `standardFlowEnabled`, `directAccessGrantsEnabled` e `implicitFlowEnabled` en `false`), mapper de audiencia `plataforma-api` y rol de realm `gerente` en su *service account*; secreto en `.env` (`.env.example` con el valor de ejemplo, nunca uno real en el commit); prueba de humo: el token *client credentials* trae `gerente` y la audiencia
- [ ] Servicio `ia-carga-inicial` en Docker Compose (misma imagen que `ia-api`, perfil propio, corre una vez y termina) sin romper `docker compose up` mientras la imagen no exista
- [ ] `recargar` vacía `reportes_db` (`rpt_*`, `evento_aplicado` y `carga_inicial`; nunca el historial de Alembic) y al final indica correr la carga inicial
