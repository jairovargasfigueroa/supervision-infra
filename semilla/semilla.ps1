# Carga los datos de prueba (011, docs/datos-prueba.md) en Obras, Finanzas, Materiales y el bucket S3 de desarrollo.
# Idempotente: lo que ya existe por id no se duplica ni se pisa (para volver al estado del documento: recargar.ps1).
# Uso: ./semilla/semilla.ps1        (D = hoy en La Paz; para fijarla: $env:SEMILLA_FECHA = '2026-10-28')
. (Join-Path $PSScriptRoot 'comun.ps1')

$config = Comprobar-Entorno
Cargar-Datos $config 'cargar'
