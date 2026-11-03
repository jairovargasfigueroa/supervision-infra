# supervision-infra

Entorno de desarrollo de la Plataforma de supervisión de obras: Docker Compose con RabbitMQ, Keycloak y DynamoDB Local y, como perfil opcional, PostgreSQL y MongoDB.

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
| DynamoDB Local (Sincronización, 101) | http://localhost:8000 |
| n8n (perfil `automatizacion`, 201) | http://localhost:5678 (cuenta de propietario `N8N_PROPIETARIO_CORREO` de `.env`) |
| Mailpit (perfil `automatizacion`, 201) | http://localhost:8025 (buzón de prueba; SMTP en `localhost:1025`) |

Si ya tienes PostgreSQL en el 5433 o MongoDB en el 27017 instalados en la máquina, **no uses el perfil `bases`**: los puertos chocan. Tu MongoDB instalado debe ser *replica set* (lo necesitan las transacciones de Materiales): ejecuta una vez, en PowerShell como administrador, `./scripts/mongo-local-replica.ps1` (en Linux o macOS, `sudo ./scripts/mongo-local-replica.sh`). La URI queda `mongodb://localhost:27017/materiales_db?replicaSet=rs0`.

### Servicio de IA en contenedor (401, opcional)

```powershell
docker compose --profile ia up -d --build    # ia-api (http://localhost:8085/salud) e ia-worker
docker compose --profile ia stop ia-api ia-worker
```

Construye la imagen de `services/ia` (`IA_DIR` de `.env`) y la usa para los dos procesos. No usa el `.env` de IA: sus variables están en `docker-compose.yml` (`x-ia-entorno`) con las claves de este `.env` (`POSTGRES_IA_CLAVE`, `RABBITMQ_IA_CLAVE`). PostgreSQL (5433) y MongoDB se buscan en la máquina (`host.docker.internal`), así que sirven tanto la instalación local como el perfil `bases`. `ia-api` aplica las migraciones de `reportes_db` antes de atender. Desde la 503 también reciben `IA_REPORTES_DB_URL_LECTURA` (rol `ia_reportes_lector`, `POSTGRES_IA_LECTOR_CLAVE`) y el modelo de lenguaje: `IA_LLM_PROVEEDOR` (`ollama` por defecto, o `anthropic`), `IA_LLM_MODELO` (vacío: `qwen3:8b` u `claude-sonnet-5-5`), `IA_OLLAMA_URL` (por defecto `http://ollama:11434`, el servicio `ollama` de la red de Compose) e `IA_ANTHROPIC_API_KEY` (solo en tu `.env`; vacía en `.env.example`). Desde la 501, el cliente y el servidor MCP: `IA_AGENTES_CLIENT_ID=ia-agentes` e `IA_AGENTES_CLIENT_SECRET` (solo `ia-worker`, el host de los agentes, recibe el secreto), `IA_OBRAS_MCP_URL`, `IA_MATERIALES_MCP_URL` e `IA_FINANZAS_MCP_URL` (`http://host.docker.internal:808N/mcp`: los servicios corren en la máquina y deben escuchar en todas las interfaces, como para la carga inicial), `IA_PROPIO_MCP_URL=http://ia-api:8085/mcp` e `IA_MCP_HOSTS_PERMITIDOS=localhost:8085,127.0.0.1:8085,ia-api:8085` (el SDK de MCP responde `421` a un `Host` que no está en la lista). Para desarrollar el servicio, también se puede correr sin Docker (`services/ia`, con `uv`); no levantes los dos a la vez (los dos usan el 8085 y la cola `ia`).

### Modelo de lenguaje local: Ollama (503 y 502, opcional)

El servicio de IA usa por defecto `IA_LLM_PROVEEDOR=ollama`: el servicio `ollama` (imagen `ollama/ollama:0.40.4`, perfil `ollama`, volumen `datos-ollama`) con el modelo `qwen3:8b` (unos 5 GB). Solo hace falta si usas Ollama; con `IA_LLM_PROVEEDOR=anthropic` y tu `IA_ANTHROPIC_API_KEY` en `.env` no lo levantes.

```powershell
docker compose --profile ollama up -d ollama           # en CPU (cualquier máquina)
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile ollama up -d ollama   # con GPU NVIDIA
docker compose --profile ia --profile ollama up -d --build     # IA y Ollama juntos
```

- Dentro de la red de Compose, `ia-api` e `ia-worker` lo llaman en `IA_OLLAMA_URL=http://ollama:11434`. El puerto 11434 se publica **solo en 127.0.0.1**, para el servicio de IA corrido con `uv` en la máquina (`IA_OLLAMA_URL=http://localhost:11434`, el valor del `.env.example` de IA); nunca fuera de ella.
- **GPU (opcional):** `docker-compose.gpu.yml` le da a `ollama` la GPU NVIDIA. Requiere Docker Desktop con WSL 2 y el controlador de NVIDIA de Windows; compruébalo con `docker run --rm --gpus all --entrypoint nvidia-smi ollama/ollama:0.40.4`. Para no repetir `-f`, pon en tu `.env` `COMPOSE_FILE=docker-compose.yml;docker-compose.gpu.yml` (en Linux y macOS, separado con `:`). Sin GPU, Ollama corre en CPU: funciona, pero cada respuesta tarda bastante más.
- Ajustes del contenedor (decisión del equipo): caché de contexto en 8 bits con *flash attention* (`OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_FLASH_ATTENTION=1`) para que el contexto de 16384 de la 503 entre en menos memoria; un modelo cargado y una petición a la vez (`OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_NUM_PARALLEL=1`); el modelo queda cargado 30 minutos (`OLLAMA_KEEP_ALIVE`).
- `./scripts/estado.ps1` muestra si responde y qué modelos tiene.

**Descargar el modelo (una vez):** `./scripts/descargar-modelo.ps1` (en Linux y macOS, `./scripts/descargar-modelo.sh`). Ejecuta `ollama pull` dentro del contenedor con `IA_LLM_MODELO` de `.env` o, si está vacío, `qwen3:8b` (otro: `-Modelo llama3.1:8b`); si `ollama` no está corriendo, lo levanta (con la GPU si tu `.env` tiene el `COMPOSE_FILE` de arriba). El modelo queda en el volumen `datos-ollama` (no se vuelve a bajar al recrear el contenedor; `reiniciar-datos` sí lo borra).

Medido el 01/11/2026 en la computadora del equipo (RTX 3060 Laptop de 6 GB, Docker con 8 GB de RAM), con `docker-compose.gpu.yml`: `qwen3:8b` (5,2 GB) con contexto de 16384 ocupa 6,7 GB y queda repartido 64 % en la GPU y 36 % en la CPU (no entra entero en 6 GB); la primera respuesta tarda unos 60 s (carga del modelo) y después una pregunta corta responde en menos de 1 s y una frase de unas 30 palabras en unos 4 s (8 *tokens* por segundo). Con salida estructurada (`format` con JSON Schema) responde un JSON válido.

### Carga inicial de la base de reportes (401)

Llena `reportes_db` con lo que ya tienen Obras, Materiales y Finanzas (por ejemplo, los datos de prueba): se corre **una vez** al crear la base, y otra vez después de cada `recargar`. Con los tres servicios levantados en la máquina:

```powershell
docker compose --profile ia-carga run --rm ia-carga-inicial   # en contenedor (aplica antes las migraciones)
# o, sin Docker, en services/ia:  uv run alembic upgrade head; uv run python -m ia.carga_inicial
```

Termina con código 0 si cargó todo y distinto de 0 si falló (dice en qué obra y servicio); correrla otra vez no duplica nada. Usa el cliente `ia-reportes` de Keycloak con el secreto `IA_REPORTES_CLIENT_SECRET` de este `.env` (en contenedor, es el único proceso que lo recibe). Llega a los servicios por `host.docker.internal:8081`, `8082` y `8083`: si alguno escucha solo en `127.0.0.1` y no responde desde el contenedor, levántalo escuchando en todas las interfaces o corre la carga sin Docker.

### Secreto del cliente `ia-agentes` (501, agentes y MCP)

El servicio de IA (`ia-worker`, host de los agentes) pide su token con *client credentials* del cliente confidencial `ia-agentes` (rol `agente_ia`, audiencia `plataforma-api`, 5 minutos) para llamar a `POST /mcp` de Obras, Materiales, Finanzas e IA. **El secreto no está en el repositorio:** el realm trae `"secret": "${IA_AGENTES_CLIENT_SECRET}"` y Keycloak lo toma de la variable del contenedor al importar.

1. En `infra/.env` pon tu propio valor en `IA_AGENTES_CLIENT_SECRET` (solo letras, números, `-` y `_`; el `.env.example` trae uno de ejemplo). Ese es el secreto en desarrollo.
2. Si Keycloak ya estaba corriendo con otro valor (o sin el cliente), recréalo para que vuelva a importar el realm: `docker compose up -d --force-recreate keycloak` (tarda menos de un minuto; se pierden las sesiones abiertas y lo cambiado a mano en el panel).
3. Cópialo a `IA_AGENTES_CLIENT_SECRET` del `.env` de `services/ia` si corres el servicio con `uv`; en contenedor, `ia-worker` lo recibe de este `.env` (`ia-api` no).
4. Para ver el que tiene Keycloak: panel `http://localhost:8080/admin` → realm `supervision` → *Clients* → `ia-agentes` → *Credentials* (o `GET /admin/realms/supervision/clients/{id}/client-secret` con el administrador de `.env`). Para probarlo:

```powershell
$s = (Select-String -Path .env -Pattern '^IA_AGENTES_CLIENT_SECRET=(.*)$').Matches[0].Groups[1].Value
(Invoke-RestMethod -Method Post http://localhost:8080/realms/supervision/protocol/openid-connect/token -Body @{ grant_type = 'client_credentials'; client_id = 'ia-agentes'; client_secret = $s }).access_token
```

`node pruebas/humo.mjs` comprueba que el token trae `agente_ia` (y ningún rol de persona), `azp = ia-agentes` y la audiencia, y que el cliente no permite iniciar sesión a una persona. Nunca subas el secreto ni lo pegues en un *issue* o *pull request*.

### Secreto del cliente `n8n` (201, cobranza automática)

Los flujos de n8n piden su token con *client credentials* del cliente confidencial `n8n` (roles `automatizacion` y `gerente`, `view-users` de `realm-management`, audiencia `plataforma-api`, 5 minutos). **El secreto no está en el repositorio:** el realm trae `"secret": "${N8N_KEYCLOAK_SECRETO}"` y Keycloak lo toma de la variable del contenedor al importar; n8n lo recibe en su credencial OAuth2 por `CREDENTIALS_OVERWRITE_DATA`.

1. En `infra/.env` pon tu propio valor en `N8N_KEYCLOAK_SECRETO` (solo letras, números, `-` y `_`; en `.env.example` está vacío). Sin él, el resto del entorno funciona igual: Keycloak importa el cliente `n8n` con un secreto al azar que nadie conoce (nunca vacío, que Keycloak aceptaría), así que el cliente queda sin uso, y el servicio `n8n` no arranca.
2. Keycloak solo importa el realm si no existe: para que tome el rol `automatizacion` y el cliente `n8n`, recréalo con `docker compose up -d --force-recreate keycloak` (menos de un minuto; se pierden las sesiones abiertas y lo cambiado a mano en el panel; los usuarios de prueba vuelven con su `id` fijo). Lo mismo si cambias el secreto.
3. `node pruebas/humo.mjs` comprueba que el token trae `automatizacion`, `gerente` (y ningún otro rol de persona), `view-users`, `azp = n8n`, la audiencia y el emisor, que lee el correo de cliente1 y que el cliente no permite iniciar sesión a una persona.

### Cobranza automática: n8n y Mailpit (201, perfil `automatizacion`)

n8n (`http://localhost:5678`) corre los tres flujos de la cobranza: «Enviar nota de cobro» (cola `n8n.cobro-emitido`), «Enviar constancia de pago» (cola `n8n.cobro-pagado`) y «Recordar cobros» (todos los días a las 08:00 de La Paz). Mailpit (`http://localhost:8025`) recibe todos los correos: en desarrollo nunca salen a internet.

**Una vez, en `infra/.env`** (los demás perfiles no las necesitan; si falta alguna, solo `n8n` se detiene y su registro dice cuál):

| Variable | Qué poner |
|---|---|
| `N8N_KEYCLOAK_SECRETO` | secreto del cliente `n8n` (sección anterior; recrea Keycloak después de ponerlo) |
| `RABBITMQ_N8N_CLAVE` | contraseña del usuario `n8n` de RabbitMQ (la crea `rabbitmq-init` al levantar) |
| `N8N_ENCRYPTION_KEY` | clave de cifrado de las credenciales de n8n, por ejemplo la salida de `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. No la cambies después: n8n no podría leer lo que ya guardó (si pasa, borra el volumen `supervision_datos-n8n`; los flujos y credenciales se vuelven a importar) |
| `N8N_PROPIETARIO_CORREO` | correo de la cuenta de propietario del panel de n8n (cualquiera, no tiene que existir) |
| `N8N_PROPIETARIO_CLAVE_HASH` | hash **bcrypt** de su contraseña, **entre comillas simples** (lleva `$`). Se genera con la imagen de n8n, sin instalar nada: `docker run --rm -w /usr/local/lib/node_modules/n8n --entrypoint node n8nio/n8n:2.43.7 -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" 'TuContraseña1'` |

Opcionales (valores por defecto en `docker-compose.yml`): `N8N_PROPIETARIO_NOMBRE` / `N8N_PROPIETARIO_APELLIDO`, `N8N_FINANZAS_URL` / `N8N_OBRAS_URL` (por defecto `http://host.docker.internal:8083` y `:8081`; llevan el prefijo `N8N_` porque `FINANZAS_URL` y `OBRAS_URL` de este `.env` ya los usan los scripts de la máquina con `localhost`), `EMPRESA_NOMBRE`, `COBRANZA_REMITENTE` y `COBRANZA_CORREO` (copia oculta de cada correo y resumen del día; `cobranzas@constructora-andina.test`).

```powershell
./scripts/levantar.ps1 -Perfil automatizacion    # todo lo de siempre, más n8n y Mailpit (n8n tarda 1 a 2 minutos)
./scripts/estado.ps1                              # «n8n: sano» y «Mailpit: responde»
```

**Qué hace n8n al arrancar** (`n8n/iniciar.sh`, en cada arranque): comprueba las variables, pasa los secretos de `.env` a `CREDENTIALS_OVERWRITE_DATA` (las credenciales de `n8n/credenciales/` no tienen secretos), arranca el reenvío de `localhost:8080` a Keycloak (`n8n/reenviar-keycloak.mjs`: así el token sale con el emisor `http://localhost:8080/realms/supervision` que validan los servicios), importa las credenciales y los flujos de `n8n/flujos/` con su `id` fijo (`n8n import:credentials` / `import:workflow --separate`), publica cada flujo (`n8n publish:workflow --id=…`; quedan activos sin reiniciar) y arranca n8n. La cuenta de propietario la crea n8n con `N8N_INSTANCE_OWNER_MANAGED_BY_ENV` y las variables `N8N_INSTANCE_OWNER_*` (están en el código de n8n 2.43.7, no en su documentación; comprobado el 02/11/2026): no hay paso manual. Si alguna vez no funcionara, n8n pide crear la cuenta al abrir el panel la primera vez.

**El repositorio manda:** al reiniciar, los flujos se vuelven a importar desde `n8n/flujos/`. Para cambiar un texto o un horario, cámbialo en el editor de n8n, pruébalo y expórtalo al repo (menú del flujo → *Download*, guardado sobre el JSON de `n8n/flujos/` con el mismo `id`); si no, se pierde al reiniciar. Nunca guardes un secreto en un flujo ni en `n8n/credenciales/`.

**Cómo se comportan** (diseño de la 201): cada nodo HTTP y de correo reintenta 3 veces cada 5 s (n8n no permite esperar más de 5 s entre intentos) y espera 10 s como máximo por llamada; si sigue fallando, la ejecución queda fallida en el panel con el motivo (*Executions*) y se puede reintentar desde ahí sin enviar dos veces el mismo correo (Finanzas guarda cada envío; el flujo no envía si ya está anotado). Los disparadores de RabbitMQ confirman el mensaje al terminar la ejecución y procesan de a uno, así un aviso repetido llega cuando el primero ya anotó su envío. «Recordar cobros» sigue con los demás cobros si uno falla (por ejemplo, un cliente sin correo) y termina la ejecución como fallida con la lista de los que no salieron. Para ejecutarlo sin esperar a las 08:00: panel → «Recordar cobros» → *Execute workflow* (nodo «Ejecutar ahora»).

**Ver los correos:** `http://localhost:8025` (con el PDF adjunto de la nota de cobro). La API la usan las pruebas: `GET /api/v1/messages`, `GET /api/v1/message/{ID}` y `GET /api/v1/message/{ID}/part/{PartID}`.

**Prueba de punta a punta:** `node pruebas/cobranza.mjs` (abajo, «Prueba de la cobranza automática»).

### Avisos al celular y al cliente (010, perfil `automatizacion`)

Tres flujos más de n8n, junto a los de la cobranza:

| Flujo | Cuándo | Qué hace |
|---|---|---|
| «Avisar stock bajo» (`avi010StockBajo0`) | evento `StockBajo` de Materiales (cola `n8n.stock-bajo`) | lee la obra (Obras) y el material (Materiales, `GET /materiales` de a 100 hasta encontrarlo) y manda un *push* al tema `obra-{obraId}-almacenero`: «Stock bajo: {material}» / «{obra}: quedan {cantidad} {unidadPlural} (mínimo {minimo})» |
| «Recordar diario» (`avi010Diario0000`) | todos los días a las 18:00 de La Paz (y «Ejecutar ahora» en el editor) | por cada obra `EN_EJECUCION` sin entrada del diario de hoy, *push* al tema `obra-{obraId}-maestro`: «Diario pendiente: {obra}». Una obra que falla no detiene a las demás; la ejecución termina fallida con la lista |
| «Avisar planilla para revisar» (`avi010Planilla00`) | evento `PlanillaPresentada` de Obras (cola `n8n.planilla-presentada`) | correo al cliente de la obra (solo a él, sin copia a cobranzas): «Planilla para revisar: N.º {numero} · {obra} · {periodo}» (o «Planilla corregida para revisar: …» si se volvió a presentar después de una observación), con el neto y el enlace `PORTAL_URL/planillas/{id}` |

**Variables** (en `infra/.env`; las de Firebase, abajo): `PORTAL_URL` (por defecto `http://localhost:4300`) y, opcional, `N8N_MATERIALES_URL` (por defecto `http://host.docker.internal:8082`; dentro del contenedor se llama `MATERIALES_URL`, como `N8N_OBRAS_URL`). Materiales debe escuchar en todas las interfaces, como Obras y Finanzas.

**Avisos que esperan en la cola:** si n8n no corre (sin el perfil `automatizacion`) o los flujos de *push* no están publicados (sin Firebase), los eventos esperan en sus colas, pero no para siempre: RabbitMQ descarta los de `n8n.stock-bajo` al día y los de `n8n.planilla-presentada` a los 7 días (políticas de `rabbitmq/definiciones.json`). Así, al configurar Firebase días después no llegan de golpe los «Stock bajo» viejos.

**Repetidos:** si el mismo aviso (mismo `id` del sobre) llega dos veces, sale un solo *push* o correo. Cada flujo guarda en sus datos estáticos los `id` de los últimos 500 avisos enviados; se anota al terminar bien, así una ejecución fallida se puede reintentar desde el panel y sí envía. Los datos estáticos solo se guardan en las ejecuciones del flujo publicado (no al probarlo a mano en el editor) y sobreviven a los reinicios de n8n (comprobado el 03/11/2026: el mismo aviso después de reiniciar no volvió a enviar). Reintentos y tiempos como en la cobranza: 3 intentos cada 5 s, 10 s por llamada.

#### Configuración de Firebase (una vez, a mano)

Sin Firebase todo funciona igual, salvo los dos flujos de *push*: n8n los importa pero no los publica (su registro dice «Firebase sin configurar…» y «flujo … importado sin publicar»), y el correo de la planilla sale igual.

1. En la [consola de Firebase](https://console.firebase.google.com/), crea un proyecto (plan gratuito *Spark*: el envío por FCM no tiene costo).
2. Agrega una app Android con el paquete `com.supervision.appobra` y descarga `google-services.json`: es para la app (`GOOGLE_SERVICES_JSON` al compilar la *development build*, README de `mobile/app-obra`), nunca va a un repositorio.
3. Configuración del proyecto → **Cuentas de servicio** → **Generar nueva clave privada** (un JSON). De ese archivo, copia a `infra/.env`:

   | Variable | Del JSON |
   |---|---|
   | `FIREBASE_PROYECTO_ID` | `project_id` |
   | `FIREBASE_CUENTA_CORREO` | `client_email` |
   | `FIREBASE_CLAVE_PRIVADA` | `private_key`: el texto entre comillas tal cual, en **una sola línea con los `\n`**, entre **comillas simples** (`FIREBASE_CLAVE_PRIVADA='-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n'`) |

   Guarda el JSON fuera de las carpetas de los repositorios (o bórralo) y nunca pegues la clave en un *issue* o *pull request*.
4. Recrea n8n para que tome las variables: `docker compose --profile automatizacion up -d n8n`. En `docker compose logs n8n` aparece «Publishing workflow with ID: avi010StockBajo0» y «… avi010Diario0000», y en el panel de RabbitMQ la cola `n8n.stock-bajo` tiene 1 consumidor.
5. Recompila la *development build* de la app con `google-services.json` (`npx expo prebuild --platform android` y `npx expo run:android`, README de `mobile/app-obra`).

**Cómo autentica n8n contra FCM:** credencial «Firebase · cuenta de servicio» (`n8n/credenciales/firebase-fcm.json`) de tipo **Google Service Account API** (`googleApi` en el código de n8n 2.43.7, `GoogleApi.credentials.js`) con «Set up for use in HTTP Request node» activado y el alcance `https://www.googleapis.com/auth/firebase.messaging`. El nodo HTTP Request la usa como credencial predefinida: n8n firma un JWT con la clave privada, lo cambia por un token de Google (`https://oauth2.googleapis.com/token`) y llama a `POST https://fcm.googleapis.com/v1/projects/{FIREBASE_PROYECTO_ID}/messages:send`. El correo y la clave llegan por `CREDENTIALS_OVERWRITE_DATA` (`n8n/secretos.sh`); el repositorio no los tiene.

**Comprobar el *push*** (con Firebase configurado; sin un proyecto de Firebase no se puede): panel de n8n → «Recordar diario» → *Execute workflow* («Ejecutar ahora») → la ejecución termina bien y en el nodo «Enviar push» FCM responde `{"name": "projects/…/messages/…"}` por cada obra sin diario de hoy; registra una salida que deje un material bajo el mínimo → la ejecución de «Avisar stock bajo» termina bien igual. En el celular (*development build*, sesión del almacenero o del maestro de esa obra) llega el aviso y al tocarlo abre el stock o el diario. Si FCM responde `404` o `403`, revisa el `FIREBASE_PROYECTO_ID` y que la clave sea de ese proyecto; `invalid_grant` es una clave o correo mal copiados.

**Cola `notificaciones` de la versión anterior:** la 010 ya no crea el servicio `services/notificaciones`, así que la cola `notificaciones` y su usuario salieron de las definiciones (y `RABBITMQ_NOTIFICACIONES_CLAVE` de `.env.example`; en tu `.env` puede quedar, nadie la lee). `rabbitmq-init` no borra nada: si tu RabbitMQ ya los tenía, bórralos una vez (la cola acumula eventos que nadie lee):

```powershell
docker compose exec rabbitmq rabbitmqctl delete_queue notificaciones
docker compose exec rabbitmq rabbitmqctl delete_user notificaciones
```

### Base de reportes (401) en la instalación local de PostgreSQL

El contenedor (perfil `bases`) crea solo, con el volumen vacío, el usuario `ia` (contraseña `POSTGRES_IA_CLAVE` de `.env`) y la base `reportes_db`, dueña de ese usuario (`postgres/init-reportes.sh`). En tu PostgreSQL instalado en el 5433 hazlo una vez a mano, como `postgres`, con la misma contraseña que pusiste en `.env`:

```sql
CREATE ROLE ia LOGIN PASSWORD 'la POSTGRES_IA_CLAVE de infra/.env';
CREATE DATABASE reportes_db OWNER ia;
```

El servicio de IA se conecta con `IA_REPORTES_DB_URL=postgresql+psycopg://ia:<POSTGRES_IA_CLAVE>@localhost:5433/reportes_db` y crea sus tablas con `alembic upgrade head`. Si ya tenías el volumen de PostgreSQL del contenedor de antes de la 401, el script no vuelve a correr: crea el usuario y la base con las mismas dos líneas (`docker compose exec postgres psql -U postgres`).

### Usuario de solo lectura de los reportes (503)

El constructor de reportes del servicio de IA lee `reportes_db` con el rol **`ia_reportes_lector`** (`LOGIN`, `default_transaction_read_only = on`, contraseña `POSTGRES_IA_LECTOR_CLAVE` de `.env`). Lo crea `postgres/lector-reportes.sql`, que es idempotente (si el rol existe, le vuelve a poner la contraseña). Los permisos `SELECT` sobre `rpt_obra_resumen`, `rpt_consumo_material`, `rpt_movimiento`, `rpt_cobro` y `rpt_planilla` los da la migración `0002` del servicio de IA, que **falla si el rol no existe**: créalo antes de levantar `ia-api` con el código de la 503.

- Contenedor nuevo (perfil `bases`, volumen vacío): lo hace solo `init-reportes.sh` (sin `POSTGRES_IA_LECTOR_CLAVE` el script se detiene).
- PostgreSQL instalado en el 5433, o volumen del contenedor que ya existía: una vez, como superusuario, con el servicio `psql-cli` (no hace falta tener `psql` instalado):

```powershell
# PowerShell, desde infra/ (POSTGRES_IA_LECTOR_CLAVE de .env; la clave del superusuario postgres de tu instalación)
docker compose --profile herramientas run --rm -e PGUSER=postgres -e PGPASSWORD='<clave de postgres>' -e PGDATABASE=postgres psql-cli -v clave='<POSTGRES_IA_LECTOR_CLAVE>' -f /lector-reportes.sql
```

En Git Bash antepón `MSYS_NO_PATHCONV=1` (si no, convierte `/lector-reportes.sql` en una ruta de Windows). El servicio de IA lo usa con `IA_REPORTES_DB_URL_LECTURA=postgresql+psycopg://ia_reportes_lector:<POSTGRES_IA_LECTOR_CLAVE>@localhost:5433/reportes_db`.

Versiones, variables de cada proyecto y orden para levantar todo: `docs/entorno-local.md` del repo `supervision-docs`. Detalle de este repo: `CLAUDE.md` y `docs/`.

## DynamoDB Local (101)

Base del servicio de Sincronización (`services/sincronizacion`), con `-sharedDb` y el volumen `datos-dynamodb` (los datos quedan al reiniciar; `./scripts/reiniciar-datos.ps1` los borra). Para levantar solo esta pieza: `docker compose up -d dynamodb`. Las tablas (`operacion_procesada` y `estado_dispositivo`) las crea Sincronización al iniciar con `DYNAMODB_CREAR_TABLAS=true`.

Listar las tablas (DynamoDB Local acepta cualquier clave; la región no importa con `-sharedDb`):

```powershell
# con AWS CLI instalado
$env:AWS_ACCESS_KEY_ID = 'local'; $env:AWS_SECRET_ACCESS_KEY = 'local'; $env:AWS_DEFAULT_REGION = 'sa-east-1'
aws dynamodb list-tables --endpoint-url http://localhost:8000
# sin instalar nada, con la imagen de AWS CLI del perfil herramientas
docker compose --profile herramientas run --rm -e AWS_ACCESS_KEY_ID=local -e AWS_SECRET_ACCESS_KEY=local s3-cli dynamodb list-tables --endpoint-url http://dynamodb:8000
```

Variables que necesita Sincronización en su `.env` (copia de su `.env.example`; el servicio corre fuera de Docker):

| Variable | Valor en desarrollo |
|---|---|
| `PORT` | `8084` |
| `KEYCLOAK_URL` / `KEYCLOAK_REALM` / `AUDIENCIA` | `http://localhost:8080` / `supervision` / `plataforma-api` |
| `OBRAS_URL` / `MATERIALES_URL` | `http://localhost:8081` / `http://localhost:8082` |
| `DYNAMODB_ENDPOINT` | `http://localhost:8000` (vacío en AWS) |
| `AWS_REGION` | `sa-east-1` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `local` / `local` (valores de prueba: DynamoDB Local acepta cualquiera) |
| `DYNAMODB_CREAR_TABLAS` | `true` (solo en desarrollo) |
| `TIEMPO_MAXIMO_LLAMADA_MS` / `TIEMPO_MAXIMO_LOTE_MS` | `5000` / `20000` |

## Probar la app en el celular

La app usa `localhost` (Keycloak 8080, Obras 8081, Materiales 8082, Sincronización 8084, Metro 8090) y el celular Android llega a la computadora con `adb reverse`: así el token sale con el mismo emisor que validan los servicios.

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

Detén antes Obras, Materiales y Finanzas (el script avisa si siguen corriendo). Vacía Finanzas (`datos-prueba:vaciar`) y Materiales (`semilla:vaciar`), las colas de la plataforma en RabbitMQ (`obras`, `materiales`, `finanzas`, `ia`, `plataforma.fallidos` y `n8n.*`, para que no lleguen mensajes viejos sobre datos borrados) la base de reportes del servicio de IA (`reportes_db`: tablas `rpt_*`, `evento_aplicado` y `carga_inicial`, con el servicio `psql-cli` y el usuario `ia`; si la base todavía no existe o no responde, avisa y sigue) y el prefijo `fotos/` del bucket; si los usuarios de Keycloak no tienen su `id`, recrea Keycloak para reimportar el realm; y carga todo con la fecha del día (Obras vacía sus tablas en la misma transacción en que carga). Nunca borra el historial de migraciones (tampoco `alembic_version` de `reportes_db`). Al final recuerda correr la **carga inicial** de la base de reportes (401), que la vuelve a llenar por REST con los datos recién cargados.

### Datos de prueba del servicio de IA (503)

La base de reportes no tiene semilla propia (la llena la carga inicial de la 401) y la carga inicial no evalúa las salidas pasadas como consumos atípicos (403): esos solo nacen de un `MovimientoRegistrado`. Para las 20 preguntas de la prueba manual de la 503 (README de `services/ia`), después de la semilla:

1. Obras, Materiales y Finanzas levantados → carga inicial (`docker compose --profile ia-carga run --rm ia-carga-inicial`); al terminar calcula el riesgo de retraso de las obras (402).
2. Con `ia-worker` corriendo y Materiales levantado: `node semilla/eventos-ia.mjs`. Vuelve a publicar, **solo en la cola `ia`** (exchange por defecto, ningún otro servicio lo recibe), el `MovimientoRegistrado` de las salidas 10033 (`FIE-12` excedido de la obra 1) y 20018 (`CEM-IP30` que superó el stock en la obra 2), con los datos que tiene Materiales (`GET /obras/{id}/movimientos` y `GET /materiales`, token de gerente1). Id fijo del evento: `fa000000-0000-4000-8000-0000000NNNNN` (N.º del movimiento); IA no aplica dos veces el mismo, así que correrlo otra vez no cambia nada. Si `ia-worker` está corriendo, espera a que vacíe la cola y muestra qué decidió el modelo.

Resultado comprobado el 01/11/2026 con el modelo `ca-1.0.0`: 20018 queda como consumo atípico `PENDIENTE` («Salió más material del que había en stock», puntaje 0,59) y 10033 el modelo la evalúa como **normal** (puntaje 0,52; el «excedido» de la 006 compara con lo previsto, el modelo con el consumo habitual). Las salidas no se fuerzan: decide el modelo.

`recargar` vacía también `ia_db.consumo_atipico` (servicio `mongo-cli`, `mongo/vaciar-ia.js`): sus documentos son salidas que acaba de borrar, y así `eventos-ia.mjs` los vuelve a crear con las fechas nuevas y en `PENDIENTE`.

Qué hay para cada conjunto del constructor de reportes el día D (valores en `docs/datos-prueba.md` de `supervision-docs`):

| Conjunto | Datos |
|---|---|
| `OBRAS` | 3 obras `EN_EJECUCION`: Las Palmeras (`NORTE`, avance 28,49 %, plazo 33,33 %), Las Lomas (`ESTE`, 16,34 % y 50,00 %, la única «en riesgo») y Nueva Esperanza (`SUR`, 0 % y 2,08 %); clientes cliente1 (obras 1 y 3) y demo1 (obra 2); nivel y porcentaje de riesgo, los que calcula la 402 |
| `CONSUMO_MATERIAL` | salidas de `M-3` (obra 1), `M-2` y `M-1` (obras 1 y 2), con monto referencial; **ninguna en el mes actual** (`M0` solo tiene ingresos de la obra 3), así que «Material usado este mes» sale vacío el día D |
| `MOVIMIENTOS` | 67 movimientos (ingresos y salidas) de `M-3` a `M0`; uno que superó el stock (20018) |
| `COBROS` | `COB-AAAA-0001` `VENCIDO` (obra 1, 290.134,80), `-0002` (obra 2, vence D + 10) y `-0003` (obra 1, vence D + 18) `PENDIENTE` |
| `PLANILLAS` | aprobadas: obra 1 N.º 1 y 2, obra 2 N.º 1; observada: obra 2 N.º 2 (sin periodo ni montos y sin «Observada por», como la deja la carga inicial). La N.º 3 de la obra 1 está `PRESENTADA` y no llega a la base de reportes |
| `CONSUMOS_ATIPICOS` | 20018 (obra 2, `M-1`) `PENDIENTE` después de `eventos-ia.mjs` |

### Datos de prueba de los agentes (502)

Escenario del diseño de la 502: obra atrasada con entradas de diario de lluvia, material bajo, salida que supera el stock, cobro vencido, planilla presentada hace más de 7 días, predicciones de riesgo (402) y consumo atípico `PENDIENTE` (403). Después de la semilla, la carga inicial y `node semilla/eventos-ia.mjs`, con Obras, Materiales, Finanzas e IA levantados:

```powershell
node semilla/agentes.mjs      # SEMILLA_FECHA fija D, como en la semilla
```

1. Registra por la API de Obras (`POST /obras/{obraId}/diario`, como maestro1, el maestro asignado; igual que Sincronización desde el celular) **9 entradas del diario**: 7 de la obra 2 (D − 26, 25, 18, 12, 11, 5 y 2; cinco con lluvia que frena columnas, vigas y la losa alivianada) y 2 de la obra 1 (D − 4 y D − 1, días normales). Ids fijos `b2000000-0000-4000-8000-000000000ONN` (O = obra, NN = correlativo); si el id ya existe, Obras devuelve el existente (correrlo otra vez no duplica). Si ese día ya tenía otra entrada (`409`), avisa y deja la que existe. Los textos y climas son una decisión del equipo para los datos de prueba (`docs/datos-prueba.md`, sección 13, solo pide «días de lluvia que explican el atraso» de la obra 2).
2. Comprueba por REST, con gerente1, cada caso del escenario y marca `ok`, `FALTA` o `sin ver` (servicio caído). No fuerza ninguno.

Lo demás ya lo traen otros pasos: material `BAJO` (`CEM-IP30` de la obra 2), salida 20018 que superó el stock y cobro `COB-AAAA-0001` `VENCIDO` (semilla, 011); planilla N.º 3 de la obra 1 `PRESENTADA` con `presentada_en` = D − 10 (semilla de Obras de la 501; la ven los agentes con la herramienta MCP `planillas_estado`, no por REST); consumo atípico `PENDIENTE` de la salida 20018 (`eventos-ia.mjs`).

**Ninguna predicción sale `ALTO`.** Con los datos de prueba y el modelo `rr-1.0.0` de la 402, ninguna obra queda en `ALTO` (comprobado el 01/11/2026: la obra 2, la atrasada, sale `BAJO` con 0,06): su única planilla aprobada tiene 16,34 % de avance, así que el «ritmo reciente» (promedio de las últimas 3 planillas aprobadas) es de 16,34 puntos por mes, casi el necesario para terminar a tiempo (17,2). El modelo da `ALTO` recién con un ritmo de unos 3 puntos por mes. Decisión de Jairo (01/11/2026): no se fuerzan los datos; la obra 2 igual sale como `ATRASO` por la regla (plazo − avance), el script solo comprueba que haya predicciones y el camino «el modelo dice `ALTO`» se prueba con datos simulados en las pruebas de IA.

Después de `recargar` (que vacía el diario con Obras) se vuelve a correr.

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

## Prueba de integración de la base de reportes (401)

Con el entorno levantado, Obras, Materiales y Finanzas corriendo (Finanzas con `mensajeria:consumir` **y** `mensajeria:publicar`), el servicio de IA corriendo (`ia-worker`; en contenedor con `docker compose --profile ia up -d --build` o con `uv` en `services/ia`) y `reportes_db` migrada:

```powershell
node pruebas/reportes.mjs              # eventos: registrar obra y aprobar planilla
node pruebas/reportes.mjs --carga      # además, la carga inicial dos veces (antes, ./semilla/semilla.ps1)
node pruebas/reportes.mjs --solo-carga # solo la carga inicial
```

**Eventos:** registra una obra «Prueba reportes 401 …» con zona `NORTE` por Obras, el residente elabora y presenta la planilla del mes y el cliente la aprueba (saga 008); comprueba en `reportes_db` que la obra aparece en `rpt_obra_resumen` en menos de 10 s con sus datos y avance 0, que pasa a `EN_EJECUCION`, la fila `APROBADA` de `rpt_planilla` (neto 15.770, monto del periodo 19.000, avance 19 %), el avance igual al de Obras y la fila `PENDIENTE` de `rpt_cobro` con número, cliente y zona. **Carga inicial:** corre `ia-carga-inicial` (o el comando de la variable `CARGA_INICIAL`, por ejemplo `cd ../services/ia && uv run python -m ia.carga_inicial`) con el cliente `ia-reportes` real, comprueba las 3 obras de los datos de prueba con tantas planillas, cobros y movimientos como tienen en ese momento Obras, Finanzas y Materiales (leídos de sus `GET`, no números fijos: una prueba manual puede haber aprobado otra planilla) y el mismo avance y zona que Obras, y que una segunda corrida deja las mismas filas y el mismo consumo. Lee `reportes_db` con `psql-cli` (solo `SELECT`). Deja la obra de prueba creada: úsala solo en desarrollo.

## Prueba de la cobranza automática (201)

Con el entorno levantado con `-Perfil automatizacion`, los datos de prueba recién cargados (`./semilla/recargar.ps1`), Obras, Materiales, Finanzas (`serve`, `mensajeria:consumir` **y** `mensajeria:publicar`) y el gateway corriendo:

```powershell
$env:N8N_PROPIETARIO_CLAVE = 'la contraseña de la cuenta de propietario de n8n'   # opcional, solo en la terminal
node pruebas/cobranza.mjs
```

1. cliente1 aprueba la planilla N.º 3 de la obra 1 (como el portal) → en menos de 1 minuto llega a Mailpit la nota de cobro a `cliente1@correo.test`, con copia oculta a cobranzas y el PDF adjunto, y Finanzas tiene el envío `NOTA_COBRO`;
2. el mismo `CobroEmitido` otra vez (solo a la cola `n8n.cobro-emitido`, no a Obras ni a IA) → ninguna nota nueva;
3. «Recordar cobros» → «Cobro vencido: COB-AAAA-0001 · Edificio Residencial Las Palmeras» a cliente1, el resumen del día a cobranzas y el envío `RECORDATORIO_VENCIDO`; ejecutado otra vez → ningún correo nuevo. Con `N8N_PROPIETARIO_CLAVE` lo ejecuta el script entrando al panel como propietario; sin ella, te pide ejecutarlo a mano y espera 3 minutos;
4. admin1 registra el pago del cobro nuevo (`registrarPagoCobro` del gateway, comprobante `PRUEBA-201`) → constancia de pago y envío `CONSTANCIA_PAGO`;
5. el mismo `CobroPagado` otra vez → ninguna constancia nueva.

Solo cuenta los correos que llegaron después de empezar. Deja la planilla aprobada y su cobro pagado: recarga los datos antes de repetirla.

## Prueba de los avisos (010)

Con el entorno levantado con `-Perfil automatizacion`, los datos de prueba recién cargados (`./semilla/recargar.ps1`) y Obras corriendo (con el evento `PlanillaPresentada` de la 010):

```powershell
node pruebas/avisos.mjs
```

1. residente2 vuelve a presentar la planilla N.º 2 de la obra 2 (observada en los datos de prueba) → Obras publica `PlanillaPresentada` con `reenvio: true` y en menos de 1 minuto llega a Mailpit «Planilla corregida para revisar: N.º 2 · Condominio Las Lomas (12 viviendas) · …» a `demo1@constructora-andina.test` (cliente de la obra), sin copia, con el neto y el enlace `PORTAL_URL/planillas/{id}`;
2. el mismo sobre otra vez (solo a la cola `n8n.planilla-presentada`) → ningún correo nuevo;
3. demo1, residente de la obra 3, elabora y presenta la planilla del mes (1 unidad de la primera partida) → «Planilla para revisar: N.º 1 · Unidad Educativa Nueva Esperanza · …» a `cliente1@correo.test`.

Para tener el sobre exacto que publicó Obras, la prueba enlaza un momento la cola temporal `prueba.avisos-010` a `evento.obras.PlanillaPresentada` y la borra al terminar. Deja las dos planillas presentadas: recarga los datos antes de repetirla. El *push* (stock bajo y diario) no se prueba aquí porque necesita un proyecto de Firebase: «Comprobar el *push*», en «Avisos al celular y al cliente».

## Prueba de punta a punta de la saga «aprobar planilla» (008)

Con el entorno levantado y los servicios corriendo (Obras, Materiales, Finanzas con `mensajeria:consumir` **y** `mensajeria:publicar`, y el gateway):

```powershell
node pruebas/saga.mjs
```

Registra una obra nueva («Prueba saga 008 …»), el residente elabora y presenta la planilla del mes, el cliente la aprueba por el portal (REST de Obras) y comprueba: planilla `APROBADA` con `COB-AAAA-NNNN`, cobro `PENDIENTE` por el neto que vence a los 30 días, reserva consumida (saldo, cobrado y reservado), avance de la obra y periodo cerrado en Materiales (`409 PERIODO_CERRADO`). Deja esos datos creados (y un material `PRB-SAGA-…` si el catálogo no tenía ninguno activo): úsala solo en desarrollo.
