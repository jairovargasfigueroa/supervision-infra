# 505 · Asistente de reportes y agentes completos · tareas de `infra`

Requisitos y diseño: `docs/specs/505-asistente-reportes/` de la carpeta que agrupa los proyectos (aprobada el 09/11/2026).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] Banco de preguntas `pruebas/banco-ia.mjs` (categorías, metas, `--agentes`) y su línea en `CLAUDE.md` y `docs/estructura.md`
- [x] Correr el banco y los agentes contra un despliegue con el modelo real y anotar el resultado
  - 09/11/2026, nube v1.1.0 con Claude Haiku 5.5, prueba mínima (`--muestra` y `--agente CONTROL_MATERIALES`, a pedido de Jairo para no gastar saldo):
    claro, difícil y seguimiento con reporte (4 a 9 s); fuera de tema y malicioso rechazados (`INTENCION_NO_RECONOCIDA`, 1 a 2 s);
    «Dame un reporte» preguntó «¿Sobre qué quieres el reporte?» y con la primera opción dio el reporte (8,7 s);
    «¿Cuánto fierro se usó?» respondió sin preguntar porque agrupa por material (cada fierro en su fila, como dice el diseño).
    Control de materiales `TERMINADA` en 21 s: 4 pasos (`stock_obra`, `consumos_atipicos`, `avance_obra` y `consumos_partida` del periodo), 3 hallazgos de stock.
    En los datos de demostración no hay consumo en noviembre: «este mes» da 0 filas (la muestra pide «el mes pasado»).
