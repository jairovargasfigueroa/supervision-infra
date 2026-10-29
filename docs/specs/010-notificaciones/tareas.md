# 010 · Notificaciones · tareas de `infra`

Requisitos y diseño: `docs/specs/010-notificaciones/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto. Requiere la fase 1 hecha (Docker Compose con RabbitMQ, Keycloak y MongoDB como *replica set*).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] RabbitMQ: cola durable `notificaciones` con sus 7 enlaces (`evento.obras.ObraRegistrada`, `evento.obras.PlanillaPresentada`, `evento.obras.PlanillaAprobada`, `evento.obras.PlanillaObservada`, `evento.materiales.StockBajo`, `evento.finanzas.CobroVencido`, `evento.finanzas.ContratoRechazado`) en el archivo de definiciones
- [ ] Si el Docker Compose levanta los servicios: servicio `notificaciones` en 8086 con sus variables (sin Firebase por defecto) y el montaje opcional de `secretos/` documentado; puerto 8086 en el README
- [ ] README: enlace a «Configuración de Firebase (lo hace el usuario)» del diseño de la 010, qué archivos van fuera del repositorio y cómo comprobar en el log si Firebase quedó configurado
- [ ] Prueba de integración de punta a punta sin Firebase (presentar planilla → notificación del cliente; aprobar → residente y `admin`; mismo mensaje dos veces → sin duplicados)
