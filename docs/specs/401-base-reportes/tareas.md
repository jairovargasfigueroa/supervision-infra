# 401 · Servicio de IA y base de reportes · tareas de `infra`

Requisitos y diseño: `docs/specs/401-base-reportes/` de esta carpeta. Contratos: `docs/contratos.md` de este proyecto.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Base `reportes_db` y usuario `ia` en el script de inicio de PostgreSQL (y nota en el README para la instalación local en el puerto 5433)
- [ ] Comprobar que las definiciones de RabbitMQ de la fase 1 traen la cola durable `ia` con sus 6 enlaces y la cola `plataforma.fallidos` (agregar lo que falte); comprobar en el panel que los eventos se acumulan con el servicio de IA apagado
- [ ] Servicios opcionales `ia-api` (8085) e `ia-worker` en Docker Compose, construidos desde `services/ia`
- [ ] Prueba de integración: registrar obra y aprobar planilla con Docker Compose y comprobar las filas en `reportes_db` (script documentado en el README)
