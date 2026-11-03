# 601 · Preparar el despliegue · tareas de `infra`

Requisitos y diseño: `docs/specs/601-contenedores-ci/` de la carpeta que agrupa los proyectos. Al implementarla, estas tareas reemplazan a `infra/docs/specs/601-contenedores-ci/tareas.md` (eran del borrador anterior).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Aplicar «Cambios a contratos y datos» que tocan este proyecto (`docs/`, `CLAUDE.md`, `.env.example`)
- [ ] Keycloak: realm con `ERP_URL`, `PORTAL_URL`, `USUARIOS_PRUEBA_CLAVE` y `KC_HOSTNAME` por variable (por defecto, los de desarrollo); prueba de importación
- [ ] Scripts de la semilla con `SEMILLA_DEMO=si` (solo `semilla`, nunca `recargar`) y fotos al S3 configurado
- [ ] `produccion-local/`: CA local y certificado de RabbitMQ, Caddyfile por grupo (el de `azure` también sirve los 5 frontends con las reglas del diseño), `compose.azure.yml`, `compose.google.yml`, `compose.aws.yml`, `.env.example`, `publicar-frontends`, `levantar` (todo o por grupo) y `bajar`
- [ ] `pruebas/humo-despliegue.mjs` con `--entorno` y `--completa`
- [ ] Ensayo completo: levantar, cargar datos de demostración, correr la prueba de humo completa y documentar en el README lo que ocupa y cómo usarlo
- [ ] `.github/workflows/ci.yml`: job `prueba` (`docker compose config -q` de todos los perfiles y de `produccion-local`, realm, definiciones y flujos bien formados) (sin imagen)
