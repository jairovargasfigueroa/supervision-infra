# 503 · Reportes por voz · tareas de `infra`

Requisitos y diseño: `docs/specs/503-reportes-voz/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto. Requiere la base `reportes_db` y el usuario `ia` de la 401.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Script de inicio de PostgreSQL: rol `ia_reportes_lector` con `LOGIN` y `default_transaction_read_only = on` (los `GRANT` sobre las tablas los aplica la migración de Alembic del servicio de IA)
- [ ] Datos de prueba para las 20 preguntas de la prueba manual, cargados publicando eventos de prueba (la base de reportes solo se llena con eventos, 401)
