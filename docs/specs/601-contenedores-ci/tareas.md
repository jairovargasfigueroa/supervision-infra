# 601 · Contenedores y CI/CD · tareas de `infra`

Requisitos y diseño: `docs/specs/601-contenedores-ci/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Docker Compose de desarrollo con la opción de levantar cada proyecto desde su imagen (perfil `imagenes`), incluidos `ia-api` e `ia-worker` de la misma imagen, para probar los Dockerfile juntos
- [ ] Workflow `ci-cd.yml`: valida los `docker-compose*.yml`, el JSON del realm, las definiciones de RabbitMQ (colas `ia`, `n8n.stock-bajo`, `n8n.compra-recibida`, `plataforma.fallidos`) y los flujos de `n8n/flujos/`; despliega los Compose de las VM de Azure y de Google (602)
- [ ] Documento `docs/github-oidc.md`: cómo crear la identidad federada en Azure, el proveedor de *Workload Identity* en Google y el rol OIDC en AWS para cada repositorio
- [ ] Crear el entorno `produccion` y cargar los secretos de despliegue en cada repositorio (lista del diseño)
