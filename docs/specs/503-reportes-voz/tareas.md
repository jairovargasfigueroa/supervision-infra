# 503 · Reportes por voz · tareas de `infra`

Requisitos y diseño: `docs/specs/503-reportes-voz/` de la carpeta que agrupa los proyectos (sección «Infra»). Contratos: `docs/contratos.md` de este proyecto. Requiere la base `reportes_db` y el usuario `ia` de la 401.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] Script de inicio de PostgreSQL: rol `ia_reportes_lector` con `LOGIN` y `default_transaction_read_only = on` (contraseña en `.env`), también para una base que ya existe. Los `GRANT` de solo lectura sobre `rpt_obra_resumen`, `rpt_consumo_material`, `rpt_movimiento`, `rpt_cobro` y `rpt_planilla` (no sobre `evento_aplicado` ni `carga_inicial`) **no van aquí**: los aplica la migración de Alembic `0002_lector_reportes` del servicio de IA, que falla si el rol todavía no existe
- [x] Variables de `x-ia-entorno` para `ia-api` e `ia-worker`: `IA_REPORTES_DB_URL_LECTURA`, `IA_LLM_PROVEEDOR` (por defecto `ollama`), `IA_LLM_MODELO`, `IA_OLLAMA_URL` (el servicio `ollama` de la red de Compose) e `IA_ANTHROPIC_API_KEY` (leída de `infra/.env`, vacía en `.env.example` y nunca en el repositorio)
- [x] Servicio `ollama` en Docker Compose: perfil `ollama`, imagen oficial `ollama/ollama` con versión fija, volumen con nombre para los modelos y sin publicar el puerto fuera de la máquina; acceso a la GPU opcional (archivo de Compose adicional) para no romper a quien no la tenga
- [x] Script `scripts/descargar-modelo` (`.ps1` y `.sh`) que ejecuta `ollama pull qwen3:8b` en el servicio `ollama` (o el modelo de `IA_LLM_MODELO`); descargar el modelo y comprobar que responde y que `ia-api` lo alcanza en `IA_OLLAMA_URL`
- [x] Datos de prueba para las 20 preguntas de la prueba manual: los de la 011 en la base de reportes (carga inicial de la 401) más los eventos de prueba que la carga inicial no produce (la base de reportes y los consumos atípicos solo se llenan con eventos, 401 y 403), publicados en la cola `ia` con ids fijos
