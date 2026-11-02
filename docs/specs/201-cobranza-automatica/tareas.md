# 201 · Cobranza automática · tareas de `infra`

Requisitos y diseño: `docs/specs/201-cobranza-automatica/` de la carpeta que agrupa los proyectos (secciones «Keycloak (infra)» y «n8n y correo (infra)»). Contratos: `docs/contratos.md` de este proyecto.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] Aplicar «Cambios a contratos y datos» que tocan este proyecto (`README.md`, `CLAUDE.md`, `docs/`)
- [x] Keycloak: rol de realm `automatizacion`; cliente confidencial `n8n` con *service account*, roles `automatizacion` y `gerente`, `view-users` de `realm-management` y el mapper de audiencia `plataforma-api`; secreto en `.env` (`.env.example` sin valor)
- [x] RabbitMQ: colas durables `n8n.cobro-emitido` y `n8n.cobro-pagado` con sus enlaces; enlace de `evento.finanzas.CobroPagado` en la cola `ia`
- [x] Docker Compose, perfil `automatizacion`: `n8n` (versión fija del diseño, volumen, zona horaria, variables de los flujos), reenvío de `localhost:8080` a Keycloak dentro de su red y `mailpit`
- [x] Flujos de n8n en `n8n/flujos/` (JSON): «Enviar nota de cobro», «Recordar cobros» y «Enviar constancia de pago»; importación al iniciar; README con los pasos manuales (cuenta de propietario y credenciales)
- [ ] Scripts de estado y de arranque con el perfil `automatizacion`
- [ ] Prueba de punta a punta (script): aprobar una planilla → correo con PDF en Mailpit y envío anotado; recordatorio del cobro vencido de la semilla; registrar un pago → constancia; volver a publicar los mismos mensajes → sin correos repetidos
