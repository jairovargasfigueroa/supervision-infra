# 502 · Agentes en el ERP · tareas de `infra`

Requisitos y diseño: `docs/specs/502-agentes-erp/` de la carpeta que agrupa los proyectos. Contratos: `docs/contratos.md` de este proyecto.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Servicio `ollama` en Docker Compose (imagen oficial, volumen de modelos) y script `scripts/descargar-modelo` que ejecuta `ollama pull qwen3:8b`
- [ ] Variable `IA_OLLAMA_URL` en `ia-api` e `ia-worker` (servicios de Compose de la 401) apuntando a `ollama`
- [ ] Datos de prueba para los agentes: una obra atrasada con entradas de diario de lluvia, un material bajo, una salida que supera el stock, un cobro vencido, una planilla presentada hace más de 7 días, una predicción de riesgo `ALTO` (402) y un consumo atípico `PENDIENTE` (403)
