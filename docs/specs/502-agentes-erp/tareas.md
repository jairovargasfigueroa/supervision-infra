# 502 · Agentes en el ERP · tareas de `infra`

Requisitos y diseño: `docs/specs/502-agentes-erp/` de la carpeta que agrupa los proyectos (sección «Infra»). Contratos: `docs/contratos.md` de este proyecto.

El servicio `ollama` (perfil `ollama`, `qwen3:8b`) y las variables `IA_LLM_*` e `IA_OLLAMA_URL` los agrega la 503; el cliente `ia-agentes` y las variables del cliente MCP, la 501. Aquí solo se usan.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] Datos de prueba para los agentes: una obra atrasada con entradas de diario de lluvia, un material bajo, una salida que supera el stock, un cobro vencido, una planilla presentada hace más de 7 días, predicciones de riesgo (402; con estos datos ninguna sale `ALTO`: ese camino se prueba con datos simulados en IA) y un consumo atípico `PENDIENTE` (403)
