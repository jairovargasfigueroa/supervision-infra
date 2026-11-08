# Nube (602): la plataforma en Azure, AWS y Google Cloud

Una máquina virtual por nube con Docker Compose, con los mismos *compose* del ensayo local (`../produccion-local/`), HTTPS de Let's Encrypt (Caddy) y los nombres bajo `supervision.workflow-tramites.site`. Las máquinas están **apagadas** salvo para probar y para la presentación. Todo se maneja desde la PC con un comando:

```sh
node nube/nube.mjs <acción> [nube]      # desde infra/; nube: azure, aws o google
```

Diseño completo (por qué, comunicación, secretos y costos): `docs/specs/602-despliegue-tres-nubes/diseno.md` de la carpeta general.

| Nube | Máquina | Qué corre | Nombres |
|---|---|---|---|
| Azure (`northcentralus`, Chicago: la suscripción de prueba no permite máquinas pequeñas en São Paulo ni en Virginia) | `vm-plataforma`, B2als_v2 (4 GiB) | `compose.azure.yml`: Caddy y los 5 frontends, Keycloak, gateway, Obras, Finanzas (API y trabajos), RabbitMQ (AMQPS 5671), n8n, Mailpit y PostgreSQL | `keycloak`, `gateway`, `obras`, `finanzas`, `erp`, `portal`, `mf-obras`, `mf-materiales`, `mf-supervision`, `n8n`, `mailpit`, `rabbitmq` |
| AWS (`us-east-2`, la única región que permite la organización de la cuenta) | `vm-sincronizacion`, t3.micro (1 GiB) | `compose.aws.yml`: Caddy y Sincronización; además DynamoDB y el bucket S3 | `sincronizacion` |
| Google (`us-east5`, Columbus) | `vm-ia`, e2-medium (4 GB) | `compose.google.yml`: Caddy, Materiales, IA, MongoDB y PostgreSQL de reportes | `materiales`, `ia` |

## Lo que hace falta en la PC

- Node 24, Docker Desktop (para generar los hashes y para la semilla) y OpenSSH (viene con Windows 11).
- CLI de Azure con sesión: `az login` (la cuenta de los créditos).
- CLI de AWS con el usuario IAM `jairo-cli`: `aws configure`. Los *scripts* usan `AWS_REGION` de `nube/.env` (`us-east-2`: la organización de la cuenta bloquea las demás regiones).
- CLI de Google (`gcloud`), cuando esté la cuenta.

## Primera vez (en este orden)

1. **Secretos:** `node nube/nube.mjs secretos`. Crea `nube/.env` con contraseñas al azar, la clave SSH `~/.ssh/supervision_nube` y los hashes de n8n y Mailpit. Al final lista lo que falta completar a mano (correos, Gmail). **Guarda una copia de `nube/.env` fuera del repo:** las bases se crean con esas contraseñas.
2. **AWS, datos:** `node nube/nube.mjs crear aws --datos`. Crea el bucket, las dos tablas, el usuario `obras-s3` (su clave queda en `nube/.env`), el rol de la máquina y el presupuesto.
3. **Release `v1.0.0`** de todos los repositorios: las máquinas descargan las imágenes `main` de GHCR. Los paquetes de GHCR tienen que ser públicos.
4. **Azure:** `node nube/nube.mjs crear azure`. Después pon los registros DNS (paso «DNS en Namecheap») y `node nube/nube.mjs desplegar azure`, que compila y copia los frontends, espera el certificado de RabbitMQ y levanta todo.
5. **AWS, máquina:** `node nube/nube.mjs crear aws`, el registro DNS de `sincronizacion` y `node nube/nube.mjs desplegar aws`.
6. **Prueba de humo sin Google:** `node pruebas/humo-despliegue.mjs --entorno nube/.env --sin-google`.
7. **Google** (cuando esté la cuenta): `crear google`, sus dos registros DNS y `desplegar google`. Después:
   - Datos de demostración: `node nube/nube.mjs contextos` y `./semilla/semilla.ps1 -Entorno nube/.env`. La carga de cada servicio corre en su máquina por SSH; las fotos suben a S3 desde la PC.
   - Carga inicial de reportes: `docker --context supervision-google compose -f nube/compose.google.yml --env-file nube/.env --profile carga run --rm ia-carga-inicial`.
   - Prueba completa: `node pruebas/humo-despliegue.mjs --entorno nube/.env --completa`.
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

## Lo que se hace a mano

- **DNS en Namecheap** (dominio `workflow-tramites.site` → «Advanced DNS» → «Add new record», tipo A, TTL 5 min). `nube.mjs dns` da la lista exacta: para Azure, `*.supervision` (o uno por nombre si Namecheap no acepta el comodín), para AWS `sincronizacion.supervision` y para Google `materiales.supervision` e `ia.supervision`. Los registros `api` y `sga-api` son de otro proyecto: no se tocan. Caddy saca los certificados solo cuando el nombre ya apunta a la máquina.
- **Gmail de la plataforma:**
  1. Crea una cuenta nueva solo para esto.
  2. Activa la verificación en dos pasos (Cuenta de Google → Seguridad).
  3. Crea una contraseña de aplicación (Seguridad → Contraseñas de aplicaciones).
  4. En `nube/.env` van `SMTP_USUARIO` (el Gmail), `SMTP_CLAVE` (las 16 letras, sin espacios), `COBRANZA_REMITENTE` y `COBRANZA_CORREO` (el mismo Gmail).
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
- Google: `MONGO_IMAGEN` (`mongo:7.0` si el *kernel* es 6.19 o más) y `IA_LLM_PROVEEDOR=anthropic` por defecto.

## Costos (precios de lista consultados el 08/11/2026)

| Recurso | Precio | Se paga |
|---|---|---|
| Azure B2als_v2 en `northcentralus` | $0,0468/h | encendida |
| AWS t3.micro en `us-east-2` | $0,0104/h | encendida |
| IP fija (una por nube) | $0,005/h (~$3,60 al mes) | siempre |
| Discos (32 GiB en Azure, 16 GiB en AWS) | unos pocos dólares al mes | siempre |

Hay un presupuesto con avisos al 50, 80 y 100 % en cada nube (`NUBE_ALERTAS_CORREO`). La cuenta de prueba de Azure tiene además el límite de gasto: al acabarse el crédito apaga los recursos en lugar de cobrar.

## Problemas comunes

- **`desplegar azure` se queda esperando el certificado de RabbitMQ:** el DNS todavía no apunta a la máquina o no se propagó. Revisa con `nslookup rabbitmq.supervision.workflow-tramites.site` y con `node nube/nube.mjs registros azure caddy`.
- **SSH rechazado:** cambió tu IP. `encender` y `desplegar` vuelven a abrir el 22 a la IP actual.
- **La B2als_v2 se queda sin memoria:** en `nube/.env`, `AZURE_TAMANO=Standard_B2as_v2` (8 GiB); en el portal, desasignar, cambiar el tamaño y encender.
- **Una máquina recreada con la misma IP:** `crear` olvida la huella SSH vieja (`ssh-keygen -R`).
