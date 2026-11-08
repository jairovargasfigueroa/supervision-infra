# 001 · Iniciar sesión y paso entre aplicaciones · tareas de `infra`

Requisitos y diseño: `docs/specs/001-iniciar-sesion/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] Agregar al realm los usuarios de prueba de la spec (contraseña `Prueba123!`), con nombre y apellido, incluido `demo1` con los roles `residente` y `cliente`
- [x] Configurar los clientes `erp`, `portal`, `app-obra` (redirects, PKCE S256, sin direct access grants) y duración de token 5 min / sesión 10 h (las dos primeras, adelantadas en la fase 1, tarea 1.4)
- [x] Exportar de nuevo el realm al JSON del repo y comprobar que se importa limpio con `docker compose up` (el realm se mantiene escrito a mano en `keycloak/realm-supervision.json`, no como exportación completa: ver `docs/estructura.md`; se comprueba con `./scripts/reiniciar-datos.ps1 -Si` y `node pruebas/humo.mjs`, 13/13)
- [x] Script `scripts/celular.ps1`/`.sh` con `adb reverse` para que la app en el celular use `localhost` y el mismo emisor del token que los servicios
