# Funciones comunes de semilla.ps1 y recargar.ps1 (011). Se carga con: . (Join-Path $PSScriptRoot 'comun.ps1')
# Pasos y guardas: docs/datos-prueba.md, sección 12, de supervision-docs.
# Continue: los errores se revisan a mano ($LASTEXITCODE) y los programas externos escriben en stderr sin fallar
$ErrorActionPreference = 'Continue'
$script:Infra = Split-Path -Parent $PSScriptRoot
$script:Ayudante = Join-Path $PSScriptRoot 'plataforma.mjs'
$script:Resumen = [ordered]@{}

function Detener([string]$Mensaje) {
    Write-Host ''
    Write-Host "ERROR: $Mensaje" -ForegroundColor Red
    exit 1
}

function Paso([string]$Titulo) {
    Write-Host ''
    Write-Host "== $Titulo" -ForegroundColor Cyan
}

function Aviso([string]$Mensaje) {
    Write-Host "AVISO: $Mensaje" -ForegroundColor Yellow
}

# Texto de una línea de salida: PowerShell 5.1 envuelve el stderr de los programas en ErrorRecord
# (y una línea vacía se vuelve "System.Management.Automation.RemoteException")
function Linea($Objeto) {
    if ($Objeto -is [System.Management.Automation.ErrorRecord]) {
        if ($Objeto.Exception -is [System.Management.Automation.RemoteException] -and $Objeto.Exception.Message -eq 'System.Management.Automation.RemoteException') { return '' }
        return $Objeto.Exception.Message
    }
    return "$Objeto"
}

# infra/.env como tabla (no se ejecuta: solo líneas NOMBRE=valor)
function Leer-Env {
    $ruta = Join-Path $Infra '.env'
    if (-not (Test-Path $ruta)) { Detener 'Falta infra/.env: copia .env.example a .env y completa los valores.' }
    $valores = @{}
    foreach ($linea in (Get-Content -Encoding UTF8 $ruta)) {
        if ($linea -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { $valores[$Matches[1]] = $Matches[2].Trim() }
    }
    return $valores
}

# Carpeta de un proyecto: la variable de .env (relativa a infra/) o la carpeta hermana por defecto
function Carpeta-Proyecto($Env, [string]$Variable, [string]$PorDefecto, [string]$Marca) {
    $valor = $Env[$Variable]
    if (-not $valor) { $valor = $PorDefecto }
    if (-not [System.IO.Path]::IsPathRooted($valor)) { $valor = Join-Path $Infra $valor }
    if (-not (Test-Path (Join-Path $valor $Marca))) {
        Detener "No encuentro el proyecto en $valor (falta $Marca). Clónalo o corrige $Variable en infra/.env."
    }
    return (Resolve-Path $valor).Path
}

function Version-Mayor([string]$Texto) {
    if ($Texto -match '(\d+)\.(\d+)') { return [int]$Matches[1] * 100 + [int]$Matches[2] }
    return 0
}

# Guardas, herramientas y piezas que deben responder. Devuelve la configuración que usan los pasos.
function Comprobar-Entorno([switch]$ConRabbitMQ) {
    Paso 'Guardas'
    $envInfra = Leer-Env
    if ($envInfra['SEMILLA_PERMITIDA'] -ne 'si') {
        Detener 'La carga de datos de prueba no está permitida aquí: falta SEMILLA_PERMITIDA=si en infra/.env (solo en desarrollo).'
    }
    Write-Host 'ok       SEMILLA_PERMITIDA=si'

    $bucket = $envInfra['S3_BUCKET']
    if ($bucket -and -not $bucket.StartsWith('supervision-dev-')) {
        Detener "El bucket '$bucket' no es de desarrollo: S3_BUCKET debe empezar con supervision-dev-. No se toca."
    }
    $fotos = [bool]($bucket -and $envInfra['AWS_ACCESS_KEY_ID'] -and $envInfra['AWS_SECRET_ACCESS_KEY'])
    if ($fotos) {
        Write-Host "ok       bucket s3://$bucket"
    } else {
        Aviso ('Se saltan las fotos: faltan S3_BUCKET, AWS_ACCESS_KEY_ID o AWS_SECRET_ACCESS_KEY en infra/.env. ' +
            'Las filas de las fotos se cargan igual en Obras, pero las imágenes no se verán hasta subirlas ' +
            '(completa .env y vuelve a correr semilla: no duplica nada).')
    }

    Paso 'Herramientas y proyectos'
    $nodo = (& node -v) 2>$null
    if ((Version-Mayor $nodo) -lt 2400) { Detener "Hace falta Node 24 (hay '$nodo'): nvm use 24." }
    Write-Host "ok       Node $nodo"
    $php = (& php -r 'echo PHP_VERSION;') 2>$null
    if ((Version-Mayor $php) -lt 803) { Detener "Hace falta PHP 8.3 o más para Finanzas (hay '$php'): usa el PHP de Herd, no el de XAMPP." }
    Write-Host "ok       PHP $php"
    if ($fotos) {
        & docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -ne 0) { Detener 'Docker no responde: abre Docker Desktop (lo usa s3-cli para las fotos).' }
    }
    $config = @{
        Env        = $envInfra
        Bucket     = $bucket
        Fotos      = $fotos
        Obras      = Carpeta-Proyecto $envInfra 'OBRAS_DIR' '../services/obras' 'mvnw.cmd'
        Finanzas   = Carpeta-Proyecto $envInfra 'FINANZAS_DIR' '../services/finanzas' 'artisan'
        Materiales = Carpeta-Proyecto $envInfra 'MATERIALES_DIR' '../services/materiales' 'package.json'
    }
    Write-Host "ok       Obras $($config.Obras)"
    Write-Host "ok       Finanzas $($config.Finanzas)"
    Write-Host "ok       Materiales $($config.Materiales)"

    Paso 'Piezas que deben responder'
    $argumentos = @('comprobar')
    if ($ConRabbitMQ) { $argumentos += '--rabbitmq' }
    & node $Ayudante @argumentos 2>&1 | ForEach-Object { Write-Host (Linea $_) }
    if ($LASTEXITCODE -ne 0) { exit 1 }
    if ($fotos) {
        $salida = Ejecutar-S3 @('s3api', 'head-bucket', '--bucket', $bucket)
        if ($LASTEXITCODE -ne 0) {
            Detener "El bucket s3://$bucket no responde con las claves de infra/.env:`n$($salida -join "`n")"
        }
        Write-Host "ok       bucket s3://$bucket"
    }
    return $config
}

# Corre un programa externo mostrando su salida, la guarda y se detiene si falla.
function Ejecutar([string]$Nombre, [string]$Carpeta, [string]$Programa, [string[]]$Argumentos) {
    Push-Location $Carpeta
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # los programas escriben en stderr sin que sea un error
    try {
        $salida = & $Programa @Argumentos 2>&1 | ForEach-Object { $linea = Linea $_; Write-Host $linea; $linea }
        $codigo = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $anterior
        Pop-Location
    }
    if ($codigo -ne 0) { Detener "$Nombre terminó con error ($codigo). Revisa la salida de arriba; los otros servicios no se tocaron después de este paso." }
    return $salida
}

# Líneas de resumen que imprime cada servicio (las que dicen «resumen» o «D = AAAA-MM-DD»), sin colores de consola
function Lineas-Resumen($Salida) {
    $lineas = @($Salida | ForEach-Object { ($_ -replace "$([char]27)\[[0-9;]*m", '').Trim() } | Where-Object { $_ -match '(?i)resumen|\bD\s*=\s*\d{4}-\d{2}-\d{2}' -and $_ -notmatch '^>' })
    if ($lineas.Count -eq 0) { return @('(el comando no imprimió una línea de resumen; revisa su salida arriba)') }
    return $lineas
}

# AWS CLI en el contenedor s3-cli (perfil herramientas); devuelve la salida
function Ejecutar-S3([string[]]$Argumentos) {
    Push-Location $Infra
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $salida = & docker compose --profile herramientas run --rm --no-TTY s3-cli @Argumentos 2>&1 |
            ForEach-Object { Linea $_ } | Where-Object { $_ -notmatch '^\s*Container .*(Creat|Start|Stopp|Remov)' }
    } finally {
        $ErrorActionPreference = $anterior
        Pop-Location
    }
    return $salida
}

function Contar-Fotos([string]$Bucket) {
    $lista = Ejecutar-S3 @('s3', 'ls', "s3://$Bucket/fotos/", '--recursive')
    if ($LASTEXITCODE -ne 0) { Detener "No se pudo listar s3://$Bucket/fotos/:`n$($lista -join "`n")" }
    return @($lista | Where-Object { $_ -match 'fotos/b0000000-0000-4000-8000-00000000000[1-3]/f1000000-[0-9a-f-]{28}\.jpg$' }).Count
}

function Verificar-Usuarios {
    & node $Ayudante usuarios 2>&1 | ForEach-Object { Write-Host (Linea $_) }
    return $LASTEXITCODE
}

# Pasos 2 a 6 de la sección 12: D, Keycloak, Obras → Finanzas → Materiales, fotos y resumen.
# ModoObras = recargar hace que Obras vacíe sus tablas antes de cargar (lo usa recargar.ps1).
function Cargar-Datos($Config, [string]$ModoObras = 'cargar') {
    Paso 'Fecha de carga'
    $fecha = & node $Ayudante fecha 2>&1 | ForEach-Object { Linea $_ }
    if ($LASTEXITCODE -ne 0) { Detener "$fecha" }
    $env:SEMILLA_FECHA = $fecha
    Write-Host "D = $fecha (SEMILLA_FECHA, la misma para los tres servicios)"

    Paso 'Keycloak: usuarios de prueba'
    $codigo = Verificar-Usuarios
    if ($codigo -eq 3) {
        Detener ('Reimporta el realm: ./semilla/recargar.ps1 lo hace, o solo Keycloak con ' +
            '"docker compose up -d --force-recreate keycloak" en infra (borra lo cambiado a mano en el panel).')
    }
    if ($codigo -ne 0) { exit 1 }

    Paso "Obras (perfil semilla, modo $ModoObras)"
    $argumentos = @('spring-boot:run', '-Dspring-boot.run.profiles=semilla')
    if ($ModoObras -eq 'recargar') { $argumentos += '-Dspring-boot.run.arguments=--semilla.modo=recargar' }
    $salida = Ejecutar 'Obras' $Config.Obras (Join-Path $Config.Obras 'mvnw.cmd') $argumentos
    $Resumen['Obras'] = Lineas-Resumen $salida

    Paso 'Finanzas (DatosPruebaSeeder)'
    $salida = Ejecutar 'Finanzas' $Config.Finanzas 'php' @('artisan', 'db:seed', '--class=DatosPruebaSeeder', '--force')
    $Resumen['Finanzas'] = Lineas-Resumen $salida

    Paso 'Materiales (npm run semilla)'
    $salida = Ejecutar 'Materiales' $Config.Materiales 'npm.cmd' @('run', 'semilla')
    $Resumen['Materiales'] = Lineas-Resumen $salida

    Paso 'Fotos al bucket S3 de desarrollo'
    if ($Config.Fotos) {
        $salida = Ejecutar-S3 @('s3', 'sync', '/semilla/fotos', "s3://$($Config.Bucket)/fotos/", '--exclude', '*', '--include', '*.jpg', '--no-progress')
        $salida | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { Detener 'No se pudieron subir las fotos (salida de arriba).' }
        $Resumen['Fotos'] = @("$(Contar-Fotos $Config.Bucket) de 10 imágenes en s3://$($Config.Bucket)/fotos/")
    } else {
        Aviso 'Fotos saltadas (sin bucket o sin claves en infra/.env).'
        $Resumen['Fotos'] = @('saltadas: falta S3_BUCKET o las claves en infra/.env')
    }

    Paso "Resumen (fecha de carga D = $fecha)"
    $Resumen['Keycloak'] = @('9 usuarios de prueba con su id fijo')
    foreach ($pieza in $Resumen.Keys) {
        foreach ($linea in $Resumen[$pieza]) { Write-Host ('{0,-11} {1}' -f "${pieza}:", $linea) }
    }
    Write-Host ''
    Write-Host 'Los indicadores son exactos el día D; antes de una demostración, ./semilla/recargar.ps1.'
}
