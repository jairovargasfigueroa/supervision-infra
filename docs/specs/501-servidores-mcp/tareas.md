# 501 · Servidores MCP · tareas de `infra`

Requisitos y diseño: `docs/specs/501-servidores-mcp/` de la carpeta que agrupa los proyectos (sección «Infra»). Contratos: `docs/contratos.md` de este proyecto.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] Agregar al realm el rol `agente_ia` y el cliente confidencial `ia-agentes` (*service account* con el rol `agente_ia`, sin *standard flow* ni *direct access grants*, mapper de audiencia `plataforma-api`; secreto en `.env` como el de `ia-reportes`)
- [x] Volver a importar el realm y comprobar que un token pedido con *client credentials* trae `realm_access.roles = ["agente_ia", …]` y `aud = plataforma-api` (prueba de humo)
- [x] Variables de `x-ia-entorno` y `.env.example`: `IA_AGENTES_CLIENT_ID=ia-agentes`, `IA_AGENTES_CLIENT_SECRET` (solo para `ia-worker`, el host), `IA_OBRAS_MCP_URL`, `IA_MATERIALES_MCP_URL`, `IA_FINANZAS_MCP_URL`, `IA_PROPIO_MCP_URL` (`http://ia-api:8085/mcp`) e `IA_MCP_HOSTS_PERMITIDOS` (incluye `ia-api:8085`)
- [x] Documentar en el README cómo obtener el secreto del cliente en desarrollo (sin subirlo al repositorio)
