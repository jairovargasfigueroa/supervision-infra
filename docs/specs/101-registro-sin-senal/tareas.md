# 101 · Registrar material sin señal · tareas de `infra`

Requisitos y diseño: `docs/specs/101-registro-sin-senal/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto. Requiere la fase 1 hecha (repositorio `infra` con su Docker Compose).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Agregar DynamoDB Local al Docker Compose (imagen `amazon/dynamodb-local` con versión fija, puerto `8000`, `-sharedDb`, volumen de datos)
- [ ] Documentar en el README de infra cómo listar las tablas (`aws dynamodb list-tables --endpoint-url http://localhost:8000`) y las variables que necesita Sincronización
