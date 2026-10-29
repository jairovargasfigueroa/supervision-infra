# 102 · Fotos sin señal y mala conexión · tareas de `infra`

Requisitos y diseño: `docs/specs/102-fotos-mala-conexion/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto. Requiere la fase 1 hecha (bucket S3 de desarrollo creado).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Documentar en el README de infra que el usuario IAM de desarrollo cubre el prefijo `temporal/` (en producción lo limita el rol de la 602)
- [ ] Documentar la regla de ciclo de vida de 7 días para `temporal/` en el bucket S3 de desarrollo (pasos de consola en el README de infra)
- [ ] Documentar en el README cómo comprobar la regla y la política
