# 001 · Iniciar sesión y paso entre aplicaciones · tareas de `infra`

Requisitos y diseño: `docs/specs/001-iniciar-sesion/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Agregar al realm los usuarios de prueba de la spec (contraseña `Prueba123!`), con nombre y apellido, incluido `demo1` con los roles `residente` y `cliente`
- [ ] Configurar los clientes `erp`, `portal`, `app-obra` (redirects, PKCE S256, sin direct access grants) y duración de token 5 min / sesión 10 h
- [ ] Exportar de nuevo el realm al JSON del repo y comprobar que se importa limpio con `docker compose up`
