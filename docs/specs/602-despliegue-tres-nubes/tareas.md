# 602 · Despliegue en tres nubes · tareas de `infra`

Requisitos y diseño: `docs/specs/602-despliegue-tres-nubes/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto. Requiere 601 en todos los repositorios.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Cuentas y créditos de estudiante revisados; `rg-supervision`, proyecto `supervision-obras` y cuenta AWS; alertas de presupuesto en las tres nubes
- [ ] Identidades OIDC de GitHub en Azure, Google y AWS (documentadas en `docs/github-oidc.md`, 601)
- [ ] `nube/azure/`: PostgreSQL Flexible (bases y usuarios por servicio, TLS obligatorio), Key Vault, entorno de Container Apps y apps `gateway`, `obras`, `finanzas-api`, `finanzas-worker` con sus secretos referenciados
- [ ] `nube/azure/`: cinco Static Web Apps (plan gratuito) y sus tokens en los repositorios de frontend
- [ ] `vm-plataforma`: Compose de producción con Caddy (rutas `/auth/`, `/n8n/`, `/rabbitmq/`, `/mailpit/` con autenticación básica), Keycloak (`KC_HOSTNAME`, `keycloak_db`), RabbitMQ (AMQPS 5671, definiciones con las colas `obras`, `materiales`, `finanzas`, `ia`, `n8n.stock-bajo`, `n8n.compra-recibida` y `plataforma.fallidos`, usuarios por servicio incluidos `ia` y `n8n`, sin `guest`), n8n y Mailpit (versiones fijas de la 201); *script* de arranque que escribe el `.env` desde Key Vault
- [ ] Realm de producción: roles `agente_ia` y `automatizacion`, clientes `erp`, `portal`, `app-obra` con los orígenes de producción, confidenciales `gateway`, `ia-agentes` y `n8n` con secretos nuevos, sin usuarios de prueba; usuarios de demostración
- [ ] n8n en producción: importar los flujos de `n8n/flujos/` (201), crear las credenciales (RabbitMQ `n8n`, OAuth2 con el cliente `n8n` y la URL de token pública, SMTP Mailpit) y fijar `FINANZAS_URL`, `COMPRAS_CORREO_REMITENTE`, `EMPRESA_NOMBRE`
- [ ] `nube/google/`: Artifact Registry, Secret Manager, servicio de Cloud Run `materiales` (1 instancia mínima, CPU siempre asignada) y MongoDB Atlas M0 sobre Google con usuarios por base (`materiales_db`, `ia_db`)
- [ ] `vm-ia`: IP estática, Compose de producción con Caddy (nombre `sslip.io` o dominio; solo publica `ia-api`), `ia-api` e `ia-worker` de la misma imagen, Ollama sin puerto público, PostgreSQL de reportes con los usuarios `ia` e `ia_reportes_lector`; `ollama pull qwen3:8b`; *script* de arranque que escribe el `.env` desde Secret Manager
- [ ] `nube/aws/`: ECR; función Lambda con imagen, 1024 MB, 60 s, URL de función sin autenticación de IAM y variables `AWS_LWA_PORT=8084` y `AWS_LWA_READINESS_CHECK_PATH=/salud`; tablas DynamoDB `operacion_procesada` (TTL `expira_en`), `estado_dispositivo` y `subida_archivo` (TTL `expira_en`) bajo demanda; rol de la función con permisos sobre las tres tablas y sobre `temporal/*`
- [ ] `nube/aws/`: bucket S3 privado con regla de ciclo de vida de 7 días en `temporal/`, regla CORS (`GET` y `PUT` desde el shell, 303) y usuarios IAM `obras-s3` (`fotos/*`, `fotos-cliente/*`) y `materiales-s3` (`notas-remision/*`)
- [ ] Configuración de producción de cada servicio (tabla del diseño, con los nombres de variables de 601) cargada en su nube; CORS del gateway y de Obras
- [ ] `nube/apagar.sh`, `nube/encender.sh` y `nube/prueba-humo.sh` (incluida la subida de una parte binaria a Sincronización)
- [ ] Si la subida binaria por la URL de Lambda falla: pasar Sincronización a ECS Express Mode con la misma imagen y documentarlo
- [ ] Prueba de punta a punta en la nube (ERP, portal con saga, app sin señal con movimiento y foto, compra automática con correo en Mailpit, agentes y reporte por voz) con capturas para el documento
- [ ] Revisión de puertos expuestos y de secretos en imágenes; resultado anotado en el README
