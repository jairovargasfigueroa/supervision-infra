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

## Prueba de punta a punta de la saga «aprobar planilla» (008)

Con el entorno levantado y los servicios corriendo (Obras, Materiales, Finanzas con `mensajeria:consumir` **y** `mensajeria:publicar`, y el gateway):

```powershell
node pruebas/saga.mjs
```

Registra una obra nueva («Prueba saga 008 …»), el residente elabora y presenta la planilla del mes, el cliente la aprueba por el portal (REST de Obras) y comprueba: planilla `APROBADA` con `COB-AAAA-NNNN`, cobro `PENDIENTE` por el neto que vence a los 30 días, reserva consumida (saldo, cobrado y reservado), avance de la obra y periodo cerrado en Materiales (`409 PERIODO_CERRADO`). Deja esos datos creados (y un material `PRB-SAGA-…` si el catálogo no tenía ninguno activo): úsala solo en desarrollo.
