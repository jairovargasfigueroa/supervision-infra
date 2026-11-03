# 010 · Avisos al celular y al cliente · tareas de `infra`

Requisitos y diseño: `docs/specs/010-notificaciones/` de la carpeta que agrupa los proyectos. Reemplazan a las tareas de la versión anterior de la 010 (servicio `services/notificaciones`, que no se crea).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] Aplicar «Cambios a contratos y datos» que tocan este proyecto (`README.md`, `docs/`); quitar de las definiciones la cola `notificaciones` y su usuario si ya no se usan
- [x] RabbitMQ: colas `n8n.stock-bajo` y `n8n.planilla-presentada` con sus enlaces; permiso de lectura del usuario `n8n`
- [x] Credencial de Firebase en n8n sin secretos (`CREDENTIALS_OVERWRITE_DATA`), variables `FIREBASE_PROYECTO_ID` y `PORTAL_URL`; sin Firebase, los flujos de *push* se importan sin publicar
- [x] Flujos «Avisar stock bajo», «Recordar diario» y «Avisar planilla para revisar» (JSON con `id` fijo); README con la configuración de Firebase
- [ ] `pruebas/humo.mjs` con las colas nuevas y `pruebas/avisos.mjs` (correo de planilla en Mailpit, sin repetidos)
