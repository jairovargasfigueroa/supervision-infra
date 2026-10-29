# supervision-infra

Entorno de desarrollo de la Plataforma de supervisión de obras: Docker Compose con RabbitMQ y Keycloak y, como perfil opcional, PostgreSQL y MongoDB.

## Primera vez

```powershell
Copy-Item .env.example .env      # completa las contraseñas vacías
./scripts/levantar.ps1           # agrega -Perfil bases si no tienes PostgreSQL ni MongoDB instalados
./scripts/estado.ps1
node pruebas/humo.mjs
```

En Linux y macOS: `cp .env.example .env`, `./scripts/levantar.sh [--perfil bases]`, `./scripts/estado.sh`.

| Pieza | Dirección |
|---|---|
| Panel de RabbitMQ | http://localhost:15672 (usuario `RABBITMQ_ADMIN_USUARIO` de `.env`) |
| Keycloak | http://localhost:8080 (panel: `/admin`, usuario `KEYCLOAK_ADMIN_USUARIO`) |
| PostgreSQL (perfil `bases`) | `localhost:5433` |
| MongoDB (perfil `bases`) | `localhost:27017` |

Si ya tienes PostgreSQL en el 5433 o MongoDB en el 27017 instalados en la máquina, **no uses el perfil `bases`**: los puertos chocan. Tu MongoDB instalado debe ser *replica set* (lo necesitan las transacciones de Materiales): ejecuta una vez, en PowerShell como administrador, `./scripts/mongo-local-replica.ps1` (en Linux o macOS, `sudo ./scripts/mongo-local-replica.sh`). La URI queda `mongodb://localhost:27017/materiales_db?replicaSet=rs0`.

Versiones, variables de cada proyecto y orden para levantar todo: `docs/entorno-local.md` del repo `supervision-docs`. Detalle de este repo: `CLAUDE.md` y `docs/`.

## Probar la app en el celular

La app usa `localhost` (Keycloak 8080, Obras 8081, Materiales 8082, Metro 8090) y el celular Android llega a la computadora con `adb reverse`: así el token sale con el mismo emisor que validan los servicios.

1. En el celular: activa las opciones de desarrollador y la **depuración USB** (o la depuración inalámbrica y empareja con `adb pair`).
2. Conecta el cable y acepta el aviso en el celular; `adb devices` debe mostrarlo.
3. `./scripts/celular.ps1` (repetir si se reconecta el celular).
4. En `mobile/app-obra`: `npm start` y abre la app en Expo Go.

## Datos de prueba (011)

Un conjunto pequeño y fijo para probar y demostrar sin registrar todo a mano: **3 obras de Santa Cruz** (Edificio Residencial Las Palmeras a buen ritmo, Condominio Las Lomas en riesgo y Unidad Educativa Nueva Esperanza recién registrada), 21 partidas, 5 planillas (una `PRESENTADA` y una `OBSERVADA`), 10 fotos, 3 contratos con sus reservas y 3 cobros (uno `VENCIDO`), 15 materiales, 67 movimientos y 3 cierres de periodo, más los 9 usuarios de Keycloak (contraseña `Prueba123!`, incluido `demo1`, residente y cliente para probar el paso del ERP al portal sin volver a iniciar sesión). Los valores y qué se ve con cada usuario están en `docs/datos-prueba.md` del repo `supervision-docs` (fuente única). **Solo desarrollo.**

### Antes de la primera carga

1. En `.env`: `SEMILLA_PERMITIDA=si` (ya viene en `.env.example`) y, si los proyectos no están en las carpetas hermanas, `OBRAS_DIR`, `FINANZAS_DIR` y `MATERIALES_DIR`.
2. Fotos: `S3_BUCKET` (debe empezar con `supervision-dev-`; cualquier otro nombre se rechaza), `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY` del usuario IAM `supervision-dev` y `AWS_DEFAULT_REGION=sa-east-1`. **Si faltan, la semilla salta las fotos con un aviso** y carga todo lo demás (las filas de las fotos sí quedan en Obras); cuando el bucket exista, completa `.env` y vuelve a correr `semilla`.
3. Entorno levantado (`./scripts/levantar.ps1`), PostgreSQL y MongoDB corriendo y las migraciones de cada servicio aplicadas (basta con haber arrancado una vez Obras, Finanzas con `php artisan migrate` y Materiales). Node 24, el PHP de Herd (8.3 o más) y Docker Desktop (para las fotos).

### Cargar

```powershell
./semilla/semilla.ps1                       # D = hoy en La Paz
$env:SEMILLA_FECHA = '2026-10-28'; ./semilla/semilla.ps1   # con una fecha fija
```

En Linux y macOS: `./semilla/semilla.sh` (o `SEMILLA_FECHA=2026-10-28 ./semilla/semilla.sh`).

Hace, en orden: guardas (`SEMILLA_PERMITIDA=si`, bucket `supervision-dev-…`), comprueba Node, PHP, las carpetas de los proyectos y que PostgreSQL, MongoDB, Keycloak y el bucket responden; calcula **una sola fecha D** y la pasa a todos en `SEMILLA_FECHA`; comprueba que los 9 usuarios de Keycloak tienen su `id` fijo; carga **Obras → Finanzas → Materiales** (cada uno con su propio comando, ver `docs/contratos.md`), sube las fotos de `semilla/fotos/` al bucket (`fotos/{obraId}/{fotoId}.jpg`) y muestra un **resumen** con D y los conteos de cada servicio. Si algo falla, se detiene con un mensaje y no sigue con los demás. La carga **no publica eventos** y es **idempotente**: correrla de nuevo no duplica nada y no pisa lo que cambiaste (por ejemplo, una planilla aprobada sigue aprobada).

### Recargar (antes de cada demostración)

```powershell
./semilla/recargar.ps1        # pide confirmación; -Si la omite (en Bash: ./semilla/recargar.sh [--si])
```

Detén antes Obras, Materiales y Finanzas (el script avisa si siguen corriendo). Vacía Finanzas (`datos-prueba:vaciar`) y Materiales (`semilla:vaciar`), las colas de la plataforma en RabbitMQ (`obras`, `materiales`, `finanzas`, `ia`, `notificaciones`, `plataforma.fallidos` y `n8n.*`, para que no lleguen mensajes viejos sobre datos borrados) y el prefijo `fotos/` del bucket; si los usuarios de Keycloak no tienen su `id`, recrea Keycloak para reimportar el realm; y carga todo con la fecha del día (Obras vacía sus tablas en la misma transacción en que carga). Nunca borra el historial de migraciones.

### Cuándo cambian los indicadores

Son exactos **el día D**. Después: desde **D + 11** el cobro de la obra 2 pasa a `VENCIDO`; desde **D + 19** la obra 1 pasa a «en riesgo» y su cobro N.º 2 vence; desde **D + 20** la obra 3 pasa a «en riesgo». Por eso se recarga antes de cada demostración.

### Fotos

`semilla/fotos/generar-fotos.ps1` dibuja las 10 imágenes con System.Drawing (Windows PowerShell 5.1, sin instalar nada): 1600 × 1200, JPEG calidad 80, fondo por obra, un dibujo simple de la partida y el texto «IMAGEN DE MUESTRA». Ya están generadas y en el repo; solo se vuelve a correr si cambian las fotos de `docs/datos-prueba.md`. Las sube y borra el servicio `s3-cli` (`amazon/aws-cli:2.38.0`, perfil `herramientas`), que se usa con `docker compose --profile herramientas run --rm s3-cli s3 …`.

### Prueba completa (con todo integrado)

1. Bases vacías con las migraciones aplicadas. `./semilla/semilla.ps1` termina sin errores y el resumen muestra: Obras 3 obras, 21 partidas, 5 planillas, 10 fotos; Finanzas 3 contratos, 3 reservas, 3 cobros; Materiales 15 materiales, 3 `obra_acceso`, 14 filas de stock, 67 movimientos, 3 cierres; 10 imágenes en el bucket.
2. `./semilla/semilla.ps1` otra vez: mismos conteos, sin errores.
3. `outbox_evento` vacía en los tres servicios y el panel de RabbitMQ (http://localhost:15672) sin mensajes nuevos en el exchange `plataforma`.
4. Levanta todo (servicios, gateway, frontends, portal y app; orden en `docs/entorno-local.md`) y revisa los criterios 7 a 14 de `docs/specs/011-datos-prueba/requisitos.md`: tablero de gerente1 (3 en ejecución, 1 en riesgo, 1 material `BAJO`, 1 cobro vencido por Bs 290.134,80, orden Las Lomas → Las Palmeras → Nueva Esperanza); detalle de Las Palmeras (28,49 % y 33,33 %, saldo 2.117.900,80, `FIE-12` excedido en `M-1`); stock de admin1; visibilidad de residente1, residente2, cliente1, cliente2 y demo1 (ERP → «Aplicaciones → Portal del cliente» sin volver a iniciar sesión); planilla 2 de la obra 2 `OBSERVADA` para residente2; fotos en el ERP, la app y el portal.
5. En el portal, cliente1 aprueba la planilla 3 de la obra 1 (neto 330.149,10): la saga termina bien y emite `COB-AAAA-0004`.
6. `./semilla/recargar.ps1`, confirma, y comprueba que todo vuelve al estado del punto 1 (la planilla 3 de la obra 1 otra vez `PRESENTADA`, 3 cobros).

## Prueba de punta a punta de la saga «aprobar planilla» (008)

Con el entorno levantado y los servicios corriendo (Obras, Materiales, Finanzas con `mensajeria:consumir` **y** `mensajeria:publicar`, y el gateway):

```powershell
node pruebas/saga.mjs
```

Registra una obra nueva («Prueba saga 008 …»), el residente elabora y presenta la planilla del mes, el cliente la aprueba por el portal (REST de Obras) y comprueba: planilla `APROBADA` con `COB-AAAA-NNNN`, cobro `PENDIENTE` por el neto que vence a los 30 días, reserva consumida (saldo, cobrado y reservado), avance de la obra y periodo cerrado en Materiales (`409 PERIODO_CERRADO`). Deja esos datos creados (y un material `PRB-SAGA-…` si el catálogo no tenía ninguno activo): úsala solo en desarrollo.
