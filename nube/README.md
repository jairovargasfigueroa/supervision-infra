# Nube (602): la plataforma en Azure, AWS y Google Cloud

Una máquina virtual por nube con Docker Compose, con los mismos *compose* del ensayo local (`../produccion-local/`), HTTPS de Let's Encrypt (Caddy) y los nombres bajo `supervision.workflow-tramites.site`. Las máquinas están **apagadas** salvo para probar y para la presentación. Todo se maneja desde la PC con un comando:

```sh
node nube/nube.mjs <acción> [nube]      # desde infra/; nube: azure, aws o google
```

Diseño completo (por qué, comunicación, secretos y costos): `docs/specs/602-despliegue-tres-nubes/diseno.md` de la carpeta general.

| Nube | Máquina | Qué corre | Nombres |
|---|---|---|---|
| Azure (`northcentralus`, Chicago: la suscripción de prueba no permite máquinas pequeñas en São Paulo ni en Virginia) | `vm-plataforma`, D4as_v5 (4 vCPU, 16 GiB) | `compose.azure.yml`: Caddy y los 5 frontends, Keycloak, gateway, Obras, Finanzas (API y trabajos), RabbitMQ (AMQPS 5671), n8n, Mailpit y PostgreSQL | `keycloak`, `gateway`, `obras`, `finanzas`, `erp`, `portal`, `mf-obras`, `mf-materiales`, `mf-supervision`, `n8n`, `mailpit`, `rabbitmq` |
| AWS (`us-east-2`, la única región que permite la organización de la cuenta) | `vm-sincronizacion`, m7i-flex.large (2 vCPU, 8 GiB; el plan gratuito de AWS solo permite algunos tamaños) | `compose.aws.yml`: Caddy y Sincronización; además DynamoDB y el bucket S3 | `sincronizacion` |
| Google (`us-east5`, Columbus) | `vm-ia`, e2-standard-4 (4 vCPU, 16 GB) | `compose.google.yml`: Caddy, Materiales, IA, MongoDB y PostgreSQL de reportes | `materiales`, `ia` |

## Lo que hace falta en la PC

- Node 24, Docker Desktop (para generar los hashes y para la semilla) y OpenSSH (viene con Windows 11).
- CLI de Azure con sesión: `az login` (la cuenta de los créditos).
- CLI de AWS con el usuario IAM `jairo-cli`: `aws configure`. Los *scripts* usan `AWS_REGION` de `nube/.env` (`us-east-2`: la organización de la cuenta bloquea las demás regiones).
- CLI de Google con sesión: `winget install -e --id Google.CloudSDK` y `gcloud auth login` (la cuenta de los créditos). Los *scripts* pasan `--project` con `GOOGLE_PROYECTO` en cada llamada: no cambian el proyecto por defecto de `gcloud`.

## Primera vez (en este orden)

1. **Secretos:** `node nube/nube.mjs secretos`. Crea `nube/.env` con contraseñas al azar, la clave SSH `~/.ssh/supervision_nube` y los hashes de n8n y Mailpit. Al final lista lo que falta completar a mano (correos, Gmail). **Guarda una copia de `nube/.env` fuera del repo:** las bases se crean con esas contraseñas.
2. **AWS, datos:** `node nube/nube.mjs crear aws --datos`. Crea el bucket, las dos tablas, el usuario `obras-s3` (su clave queda en `nube/.env`), el rol de la máquina y el presupuesto.
3. **Release `v1.0.0`** de todos los repositorios: las máquinas descargan las imágenes `main` de GHCR. Los paquetes de GHCR tienen que ser públicos.
4. **Azure:** `node nube/nube.mjs crear azure`. Después pon los registros DNS (paso «DNS en Namecheap») y `node nube/nube.mjs desplegar azure`, que compila y copia los frontends, espera el certificado de RabbitMQ y levanta todo.
5. **AWS, máquina:** `node nube/nube.mjs crear aws`, el registro DNS de `sincronizacion` y `node nube/nube.mjs desplegar aws`.
6. **Prueba de humo sin Google:** `node pruebas/humo-despliegue.mjs --entorno nube/.env --sin-google`.
7. **Google:** `node nube/nube.mjs crear google`. Crea el proyecto `supervision-obras` (si ese ID ya lo usa otra cuenta, con un sufijo que guarda en `nube/.env`), lo une a la cuenta de facturación de los créditos (si hay varias, la de `GOOGLE_FACTURACION`), activa Compute Engine y crea la red `vpc-supervision` con su *firewall*, la IP fija y `vm-ia`; al final fija `MONGO_IMAGEN` según el *kernel*. Después sus dos registros DNS y `desplegar google`. Luego:
   - Datos de demostración: `node nube/nube.mjs contextos` y `./semilla/semilla.ps1 -Entorno nube/.env`. La carga de cada servicio corre en su máquina por SSH; las fotos suben a S3 desde la PC.
   - Carga inicial de reportes, en la máquina de Google (por el contexto de Docker, Compose tomaría las rutas de la PC para los volúmenes de PostgreSQL): `ssh supervision-google "docker compose -f /opt/supervision/nube/compose.google.yml --profile carga run --rm ia-carga-inicial"`.
   - Escenario de los agentes y consumos atípicos: `node semilla/eventos-ia.mjs --entorno nube/.env` y `node semilla/agentes.mjs --entorno nube/.env`.
   - Prueba completa: `node pruebas/humo-despliegue.mjs --entorno nube/.env --completa`. **Crea datos**: una obra «Humo 601 …» con su planilla aprobada y su cobro cada vez que corre. Córrela antes de una demostración solo si después vuelves a dejar los datos limpios (sección siguiente); para revisar el despliegue sin crear nada, sin `--completa`.
   - El APK que apunta a la nube: `scripts/apk-nube.ps1` de app-obra.
8. **Al terminar:** `node nube/nube.mjs apagar todas`.

## Cada vez que se usa

```sh
node nube/nube.mjs encender todas   # Azure primero; abre el 22 a tu IP actual y espera a que todo esté sano (~5 min)
node nube/nube.mjs estado           # máquinas, IP, contenedores y /salud
node nube/nube.mjs apagar todas     # Azure queda desasignada: sin cobro de cómputo
```

Para una nube sola, en lugar de `todas`: `azure`, `aws` o `google`. Otras acciones:

| Acción | Qué hace |
|---|---|
| `registros <nube> [servicio]` | últimas 200 líneas de `docker compose logs` |
| `ssh <nube>` | sesión en la máquina (también `ssh supervision-azure`: el comando agrega los nombres a `~/.ssh/config`, en un bloque marcado) |
| `dns` | los registros A que van en Namecheap, con las IP |
| `desplegar <nube>` | vuelve a copiar archivos y `.env`, descarga imágenes y levanta (para una versión nueva). En Azure, `--sin-frontends` usa los de `nube/sitios` |
| `contextos` | contextos de Docker `supervision-<nube>` por SSH (los usa la semilla) |

**Volver atrás un servicio:** en `nube/.env`, `<SERVICIO>_ETIQUETA=sha-<7>` (por ejemplo `OBRAS_ETIQUETA=sha-1a2b3c4`, la etiqueta anterior en GHCR) y `desplegar` de su nube.

## Volver a dejar los datos de demostración limpios

Para empezar de cero antes de una demostración (borra lo que se registró al probar, también las obras «Humo 601 …»). Por diseño, `semilla` en modo demostración solo carga y `recargar` nunca corre contra la nube: el vaciado se hace a mano por SSH, igual que el de cada servicio en desarrollo. No se tocan Keycloak (su base `keycloak_db`), n8n, Firebase, los certificados ni las fotos de demostración del bucket.

1. **Azure:** `TRUNCATE … RESTART IDENTITY CASCADE` de todas las tablas de `obras_db` salvo `flyway_schema_history` y de `finanzas_db` salvo `migrations` (en `supervision-azure-postgres-1`, con `psql -U $POSTGRES_USER`, la lista de tablas sale de `pg_tables`); vaciar las colas con mensajes (`rabbitmqctl -q list_queues -p / name messages` y `purge_queue`) y Mailpit (`DELETE /api/v1/messages` con su usuario y clave).
2. **Google:** `deleteMany({})` de las colecciones de `materiales_db` y, en `ia_db`, de `consulta_reporte`, `conversacion_reporte`, `receta_cache`, `limite_consulta`, `ejecucion_agente`, `sugerencia`, `prediccion` y `consumo_atipico` (en `supervision-google-mongo-1`); `reportes_db` con `postgres/vaciar-reportes.sql` (`ssh supervision-google 'docker exec -i supervision-google-postgres-reportes-1 sh -c "psql -U \$POSTGRES_USER -d reportes_db"' < postgres/vaciar-reportes.sql`).
3. **Cargar:** `node nube/nube.mjs contextos`, `./semilla/semilla.ps1 -Entorno nube/.env` (D = hoy; con `SEMILLA_HISTORIA=si` en `nube/.env` carga también la historia de demostración de la 603: obras 4 a 6 con meses de uso) y la carga inicial de reportes por SSH (paso 7 de «Primera vez»), que también recalcula el riesgo.
4. **Escenario:** `node semilla/eventos-ia.mjs --entorno nube/.env --todas` (las salidas de las obras 4 a 6 y las dos de la 011 a la 403; unos minutos) y `node semilla/agentes.mjs --entorno nube/.env` (diario de las seis obras; debe decir «El escenario está completo»).
5. **Revisar:** `node pruebas/humo-despliegue.mjs --entorno nube/.env` (sin `--completa`) y el tablero: 6 obras; riesgo del modelo BAJO, ALTO y MEDIO en las obras 4, 5 y 6.

En el celular, después de vaciar: cerrar sesión en la app y volver a entrar, para que descargue los datos nuevos.

## Lo que se hace a mano

- **DNS en Namecheap** (dominio `workflow-tramites.site` → «Advanced DNS» → «Add new record», tipo A, TTL 5 min). `nube.mjs dns` da la lista exacta: para Azure, `*.supervision` (o uno por nombre si Namecheap no acepta el comodín), para AWS `sincronizacion.supervision` y para Google `materiales.supervision` e `ia.supervision`. Los registros `api` y `sga-api` son de otro proyecto: no se tocan. Caddy saca los certificados solo cuando el nombre ya apunta a la máquina.
- **Gmail de la plataforma:**
  1. Crea una cuenta nueva solo para esto.
  2. Activa la verificación en dos pasos (Cuenta de Google → Seguridad).
  3. Crea una contraseña de aplicación (Seguridad → Contraseñas de aplicaciones).
  4. En `nube/.env` van `SMTP_HOST=smtp.gmail.com`, `SMTP_PUERTO=587`, `SMTP_SEGURO=false`, `SMTP_USUARIO` (el Gmail), `SMTP_CLAVE` (las 16 letras, sin espacios), `COBRANZA_REMITENTE` y `COBRANZA_CORREO` (el mismo Gmail). Con `SMTP_HOST` vacío, el correo queda en Mailpit.
  5. `CLIENTE1_CORREO` es un buzón tuyo, donde llega la nota de cobro de `cliente1`.

  Keycloak toma `CLIENTE1_CORREO` solo la primera vez que importa el realm; después se cambia en su consola.
- **Firebase** (010): sus tres variables en `nube/.env` y `desplegar azure`; el `google-services.json` para el APK.
- **Anthropic** (Google): la clave en `IA_ANTHROPIC_API_KEY`, con un límite de gasto puesto en su consola.

## Qué cambia respecto del ensayo local

- Direcciones reales en 443 (en los Caddyfile, `<pieza>.{$DOMINIO}`), Let's Encrypt en lugar de la CA local y sin montar `certificados/` en los servicios.
- Imágenes de GHCR (`IMAGEN_ETIQUETA`, por defecto `main`) sin `build:`, con rotación de registros.
- Dentro de cada máquina, los nombres de sus propias piezas apuntan a su Caddy (`extra_hosts: host-gateway`); los de las otras nubes, por DNS.
- Azure:
  - Sin `finanzas-reenvio`.
  - RabbitMQ usa el certificado de `rabbitmq.<dominio>` que saca Caddy (`maquina/certificado-rabbitmq.sh` lo copia al desplegar, al encender y una vez al día).
  - Mailpit con autenticación básica.
  - El correo sale por `SMTP_*` (Gmail; vacías, Mailpit).
  - `CLIENTE1_CORREO`.
  - Obras usa S3 real con `obras-s3`.
- AWS: sin DynamoDB Local ni MinIO. Sincronización usa el rol de la máquina (IMDSv2, sin claves) y no crea tablas.
- Google:
  - `MONGO_IMAGEN` (`mongo:7.0` si el *kernel* es 6.19 o más) e `IA_LLM_PROVEEDOR=anthropic` por defecto.
  - Red propia `vpc-supervision` (la `default` de un proyecto nuevo deja el 22 y el 3389 abiertos a internet) con dos reglas: `supervision-web` (80 y 443) y `supervision-ssh` (22 solo desde tu IP).
  - La máquina va sin cuenta de servicio: Materiales e IA no llaman a APIs de Google.

## Costos (precios de lista consultados el 08/11/2026)

| Recurso | Precio | Se paga |
|---|---|---|
| Azure D4as_v5 en `northcentralus` | ~$0,17/h | encendida |
| AWS m7i-flex.large en `us-east-2` | ~$0,10/h (créditos del plan gratuito) | encendida |
| Google e2-standard-4 en `us-east5` | ~$0,13/h (créditos de la prueba) | encendida |
| IP fija (una por nube) | $0,005/h (~$3,60 al mes) | siempre |
| Discos (32 GiB en Azure, 16 GiB en AWS) | unos pocos dólares al mes | siempre |

Con `NUBE_ALERTAS_CORREO` (opcional) se crea un presupuesto con avisos al 50, 80 y 100 % en cada nube. La cuenta de prueba de Azure tiene además el límite de gasto: al acabarse el crédito apaga los recursos en lugar de cobrar. En Google el presupuesto se crea en la consola (Facturación → Presupuestos y alertas); la prueba gratuita no cobra a la tarjeta mientras no se active la cuenta completa.

## Problemas comunes

- **`desplegar azure` se queda esperando el certificado de RabbitMQ:** el DNS todavía no apunta a la máquina o no se propagó. Revisa con `nslookup rabbitmq.supervision.workflow-tramites.site` y con `node nube/nube.mjs registros azure caddy`.
- **SSH rechazado:** cambió tu IP. `encender` y `desplegar` vuelven a abrir el 22 a la IP actual (en las tres nubes).
- **Cambiar el tamaño de una máquina:** con la máquina apagada, `az vm resize -g rg-supervision -n vm-plataforma --size <tamaño>`, `gcloud compute instances set-machine-type vm-ia --zone us-east5-a --machine-type <tipo> --project <GOOGLE_PROYECTO>` o `aws ec2 modify-instance-attribute --instance-id <id> --instance-type Value=<tipo>`, y el mismo valor en `AZURE_TAMANO`, `GOOGLE_TIPO` o `AWS_TIPO` de `nube/.env`. Azure deja hasta 4 vCPU por región en la suscripción de prueba y el plan gratuito de AWS solo ciertos tipos (`aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true`).
- **Una máquina recreada con la misma IP:** `crear` olvida la huella SSH vieja (`ssh-keygen -R`).
