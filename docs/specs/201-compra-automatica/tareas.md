# 201 · Compra automática por stock bajo · tareas de `infra`

Requisitos y diseño: `docs/specs/201-compra-automatica/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto. Requiere la fase 1 hecha (Docker Compose con RabbitMQ y Keycloak).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Keycloak: rol de realm `automatizacion` y cliente confidencial `n8n` con *service account* y mapper de audiencia `plataforma-api`; exportar el realm de nuevo
- [ ] RabbitMQ: colas `n8n.stock-bajo` y `n8n.compra-recibida` con sus claves en el archivo de definiciones
- [ ] Contenedores n8n (5678, volumen, zona horaria La Paz, clave de cifrado en `.env`) y Mailpit (1025 / 8025), con versiones fijas
- [ ] Flujos «Compra por stock bajo» y «Cuenta por pagar al recibir compra» exportados en `n8n/flujos/` e importados al iniciar
- [ ] README: cómo crear las credenciales de n8n (RabbitMQ, OAuth2, SMTP) y cómo ver los correos en Mailpit
- [ ] Prueba de integración de punta a punta (stock bajo → orden enviada y correo → ingreso con orden → cuenta por pagar; mensajes repetidos sin duplicados)
