# 011 · Datos de prueba · tareas de `infra`

Requisitos y diseño: `docs/specs/011-datos-prueba/` de esta carpeta. Datos: `docs/datos-prueba.md` (secciones 1, 3, 10 y 12). Contratos: `docs/contratos.md` de este proyecto.

Se implementa **después de la 009** y de las tareas de la 011 en Obras, Finanzas y Materiales (los scripts llaman a sus comandos). Si una capa agrega su propia semilla (por ejemplo la del servicio de IA en la 401), esa capa la suma a `semilla` y `recargar` en el mismo trabajo.

Marca cada tarea al terminarla (con sus pruebas y su commit).

- [ ] Usuarios del realm con `id`, nombre, apellido y correo fijos de la sección 3, incluido `demo1` (roles `residente` y `cliente`); exportar el JSON y comprobar que el `sub` del token de cada usuario es su `id`
- [ ] `semilla/fotos/generar-fotos.ps1` (System.Drawing) y las 10 imágenes generadas en `semilla/fotos/{obraId}/{fotoId}.jpg`
- [ ] Servicio `s3-cli` (`amazon/aws-cli:2.38.0`) en Docker Compose con perfil `herramientas`, con las credenciales del usuario IAM de desarrollo y el bucket de `S3_BUCKET` (debe empezar con `supervision-dev-`), y la carpeta de fotos montada de solo lectura
- [ ] `semilla/semilla.ps1` y `semilla/semilla.sh`: guardas (`SEMILLA_PERMITIDA=si`), comprobación de servicios, D única en `SEMILLA_FECHA`, verificación de usuarios de Keycloak, Obras → Finanzas → Materiales → fotos, resumen; variables nuevas en `.env.example`
- [ ] `semilla/recargar.ps1` y `semilla/recargar.sh`: confirmación (`-Si` / `--si`), vaciado de cada servicio con su comando, de las colas de la plataforma y del bucket, reimportación de usuarios si sus `id` no coinciden, y carga
- [ ] Prueba documentada: `semilla` dos veces (mismos conteos), revisión de los criterios de `requisitos.md`, aprobación de la planilla 3 de la obra 1 en el portal y `recargar`
- [ ] README de infra: sección «Datos de prueba»
