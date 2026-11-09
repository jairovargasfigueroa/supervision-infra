# 603 · Historia de demostración · tareas de `infra`

Requisitos y diseño: `docs/specs/603-historia-demostracion/` de la carpeta que agrupa los proyectos (decisión de Jairo del 09/11/2026).

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [x] `semilla/historia/generar.mjs`: historia de las obras 4 a 6 coherente entre los tres servicios (planillas, cobros y pagos, envíos, compras y salidas, stock, cierres y fotos), verificada con las validaciones de cada servicio y con el modelo de riesgo (BAJO, ALTO y MEDIO)
- [x] `semilla/historia/diario.mjs` y `agentes.mjs`: diario de lunes a sábado de las seis obras con `SEMILLA_HISTORIA=si`
- [x] `eventos-ia.mjs --todas`: las salidas de las obras 4 a 6 (y las dos de la 011) a la 403 en orden cronológico; las de las obras 1 a 3 no, porque son grandes lotes y darían falsos positivos
- [x] `comun.ps1` y `comun.sh`: `SEMILLA_HISTORIA` a los tres servicios; `nube/.env.example` y `produccion-local/.env.example` con `SEMILLA_HISTORIA=si`
- [x] Cargar en la nube (vaciado, semilla, carga inicial, `eventos-ia --todas`, `agentes`) y revisar tablero, riesgo y atípicos
  - 09/11/2026, v1.2.0: 6 obras, 23 planillas, 20 cobros, 1.529 movimientos, 45 fotos, 712 entradas del diario; riesgo 4 BAJO (0,8 %), 5 ALTO (96 %), 6 MEDIO (60 %); 6 consumos atípicos (1, 1, 3 y 1 en las obras 1, 2, 5 y 6). La primera vez `--todas` pasó también las salidas de las obras 1 y 2 (37 falsos positivos, borrados a mano en `ia_db` con sus predicciones, y la carga inicial otra vez); corregido en el script.
