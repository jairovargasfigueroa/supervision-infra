# 603 · Historia de demostración · tareas de `infra`

Requisitos y diseño: `docs/specs/603-historia-demostracion/` de la carpeta que agrupa los proyectos (decisión de Jairo del 09/11/2026).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] `semilla/historia/generar.mjs`: historia de las obras 4 a 6 coherente entre los tres servicios (planillas, cobros y pagos, envíos, compras y salidas, stock, cierres y fotos), verificada con las validaciones de cada servicio y con el modelo de riesgo (BAJO, ALTO y MEDIO)
- [x] `semilla/historia/diario.mjs` y `agentes.mjs`: diario de lunes a sábado de las seis obras con `SEMILLA_HISTORIA=si`
- [x] `eventos-ia.mjs --todas`: todas las salidas a la 403 en orden cronológico
- [x] `comun.ps1` y `comun.sh`: `SEMILLA_HISTORIA` a los tres servicios; `nube/.env.example` y `produccion-local/.env.example` con `SEMILLA_HISTORIA=si`
- [ ] Cargar en la nube (vaciado, semilla, carga inicial, `eventos-ia --todas`, `agentes`) y revisar tablero, riesgo y atípicos
