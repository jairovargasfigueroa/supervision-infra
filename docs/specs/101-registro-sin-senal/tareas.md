# 101 · Registrar material sin señal · tareas de `infra`

Requisitos y diseño: `docs/specs/101-registro-sin-senal/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto. Requiere la fase 1 hecha (repositorio `infra` con su Docker Compose).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] Agregar DynamoDB Local al Docker Compose (imagen `amazon/dynamodb-local` con versión fija, puerto `8000`, `-sharedDb`, volumen de datos)
- [x] Documentar en el README de infra cómo listar las tablas (`aws dynamodb list-tables --endpoint-url http://localhost:8000`) y las variables que necesita Sincronización
- [x] Realm (diseño 101, «Cambios a contratos y datos»): `offlineSessionIdleTimeout` 2592000 y *scope* opcional `offline_access` en el cliente `app-obra`
- [x] `scripts/celular.ps1` y `.sh`: `adb reverse` también del `8084` (Sincronización) para probar la app en el celular
- [x] `pruebas/humo.mjs`: sesión offline del realm y de `app-obra` (refresh token `Offline` de almacenero1) y DynamoDB Local; `obtenerTokensUsuario` con `scope` en `pruebas/token-usuario.mjs`
