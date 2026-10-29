# 501 · Servidores MCP · tareas de `infra`

Requisitos y diseño: `docs/specs/501-servidores-mcp/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Agregar al realm el rol `agente_ia` y el cliente confidencial `ia-agentes` (*service account* con el rol `agente_ia`, sin *standard flow* ni *direct access grants*, mapper de audiencia `plataforma-api`)
- [ ] Exportar de nuevo el realm y comprobar que un token pedido con *client credentials* trae `realm_access.roles = ["agente_ia", …]` y `aud = plataforma-api`
- [ ] Documentar en el README cómo obtener el secreto del cliente en desarrollo (sin subirlo al repositorio)
