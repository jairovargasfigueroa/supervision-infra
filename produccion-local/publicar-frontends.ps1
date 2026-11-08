# 601 · Publica los 5 frontends como archivos estáticos para el Caddy del grupo azure: compila cada uno (npm run build;
# con -SinCompilar toma la carpeta compilada que ya tiene), la copia a produccion-local/sitios/<frontend>/ (el Caddy
# la monta en /sitios) y escribe con las variables de .env los archivos que dependen del entorno: configuracion.json
# del shell y del portal y federation.manifest.json del shell, a partir de sus plantillas (*.plantilla). La misma
# compilación sirve en cualquier entorno; en la 602 se hace lo mismo hacia el hosting de estáticos.
# Uso: ./produccion-local/publicar-frontends.ps1 [-SinCompilar] [-Solo erp-shell,portal] [-Entorno <.env>] [-Destino <carpeta>]
# 602: -Entorno toma las direcciones de otro .env (la nube: nube/.env) y -Destino copia a otra carpeta (nube/sitios).
# Ojo: compilar mf-materiales o mf-supervision reescribe su dist/, que también usa su servidor de desarrollo
# (npm start): si está corriendo, detenlo antes o usa -SinCompilar.
param([switch]$SinCompilar, [string[]]$Solo, [string]$Entorno, [string]$Destino)
. (Join-Path $PSScriptRoot 'comun.ps1')
if ($Entorno) { $script:RutaEnv = (Resolve-Path $Entorno).Path }
$sitios = if ($Destino) { New-Item -ItemType Directory -Force $Destino | Out-Null; (Resolve-Path $Destino).Path } else { Join-Path $Dir 'sitios' }

$envPl = Leer-Env
# Nombre, variable de la carpeta, carpeta por defecto, salida de la compilación, plantillas y sus variables
$frontends = @(
    @{ Nombre = 'erp-shell'; Variable = 'ERP_SHELL_DIR'; PorDefecto = '../../frontend/erp-shell'; Salida = 'dist/erp-shell/browser'
       Plantillas = @('configuracion.json', 'federation.manifest.json')
       Variables = @('KEYCLOAK_URL', 'KEYCLOAK_REALM', 'GATEWAY_URL', 'PORTAL_URL', 'MF_OBRAS_URL', 'MF_MATERIALES_URL', 'MF_SUPERVISION_URL') },
    @{ Nombre = 'mf-obras'; Variable = 'MF_OBRAS_DIR'; PorDefecto = '../../frontend/mf-obras'; Salida = 'dist/mf-obras/browser'; Plantillas = @(); Variables = @() },
    @{ Nombre = 'mf-materiales'; Variable = 'MF_MATERIALES_DIR'; PorDefecto = '../../frontend/mf-materiales'; Salida = 'dist'; Plantillas = @(); Variables = @() },
    @{ Nombre = 'mf-supervision'; Variable = 'MF_SUPERVISION_DIR'; PorDefecto = '../../frontend/mf-supervision'; Salida = 'dist'; Plantillas = @(); Variables = @() },
    @{ Nombre = 'portal'; Variable = 'PORTAL_DIR'; PorDefecto = '../../frontend/portal'; Salida = 'dist'
       Plantillas = @('configuracion.json'); Variables = @('KEYCLOAK_URL', 'KEYCLOAK_REALM', 'OBRAS_URL', 'ERP_URL') }
)
if ($Solo) {
    $nombres = @($Solo | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $frontends = @($frontends | Where-Object { $nombres -contains $_.Nombre })
    if ($frontends.Count -eq 0) { Detener "Ninguno de '$($nombres -join ', ')' es un frontend (erp-shell, mf-obras, mf-materiales, mf-supervision, portal)." }
}

# Plantilla con ${VARIABLE}: solo se reemplazan las variables de la lista (como envsubst con su lista); si falta una
# en .env, se detiene (un archivo de configuración a medias rompería el frontend sin decir por qué)
function Escribir-Plantilla([string]$Plantilla, [string]$Destino, [string[]]$Variables) {
    $texto = [System.IO.File]::ReadAllText($Plantilla)
    foreach ($variable in $Variables) {
        if ($texto.Contains('${' + $variable + '}')) {
            if (-not $envPl[$variable]) { Detener "Falta $variable en $RutaEnv (la usa $Plantilla)." }
            $texto = $texto.Replace('${' + $variable + '}', $envPl[$variable])
        }
    }
    if ($texto -match '\$\{([A-Za-z_][A-Za-z0-9_]*)\}') { Detener "La plantilla $Plantilla usa `${$($Matches[1])}, que este script no conoce." }
    [System.IO.File]::WriteAllText($Destino, $texto, (New-Object System.Text.UTF8Encoding($false)))
}

foreach ($frontend in $frontends) {
    $carpeta = Carpeta $envPl $frontend.Variable $frontend.PorDefecto
    Paso "$($frontend.Nombre) ($carpeta)"
    if (-not (Test-Path (Join-Path $carpeta 'package.json'))) { Detener "No encuentro el proyecto en ${carpeta}: clónalo o corrige $($frontend.Variable) en $RutaEnv." }
    if (-not $SinCompilar) {
        Push-Location $carpeta
        try {
            if (-not (Test-Path 'node_modules')) {
                & npm.cmd ci --no-audit --no-fund 2>&1 | ForEach-Object { Write-Host (Linea $_) }
                if ($LASTEXITCODE -ne 0) { Detener "npm ci falló en $($frontend.Nombre)." }
            }
            & npm.cmd run build 2>&1 | ForEach-Object { Write-Host (Linea $_) }
            if ($LASTEXITCODE -ne 0) { Detener "npm run build falló en $($frontend.Nombre) (salida de arriba)." }
        } finally { Pop-Location }
    }
    $salida = Join-Path $carpeta $frontend.Salida
    if (-not (Test-Path (Join-Path $salida 'index.html')) -and -not (Test-Path (Join-Path $salida 'remoteEntry.json'))) {
        Detener "No hay compilación en $salida (sin index.html ni remoteEntry.json): compila sin -SinCompilar."
    }
    $sitio = Join-Path $sitios $frontend.Nombre
    if (Test-Path $sitio) { Remove-Item -Recurse -Force $sitio }
    New-Item -ItemType Directory -Force $sitio | Out-Null
    Copy-Item -Recurse -Force (Join-Path $salida '*') $sitio
    Write-Host "ok       copiado a $sitio"
    foreach ($archivo in $frontend.Plantillas) {
        $plantilla = @((Join-Path $carpeta "$archivo.plantilla"), (Join-Path $carpeta "public\$archivo.plantilla")) | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $plantilla) { Detener "Falta la plantilla $archivo.plantilla en $carpeta (tarea de la 601 de $($frontend.Nombre))." }
        Escribir-Plantilla $plantilla (Join-Path $sitio $archivo) $frontend.Variables
        Write-Host "ok       $archivo escrito con las direcciones de $RutaEnv"
    }
    if ($frontend.Nombre -eq 'erp-shell') {
        # 104: el service worker del shell guarda los remotos de estas direcciones (la compilación trae las de desarrollo)
        & node (Join-Path $Dir 'ajustar-ngsw.mjs') (Join-Path $sitio 'ngsw.json') $envPl['MF_OBRAS_URL'] $envPl['MF_MATERIALES_URL'] $envPl['MF_SUPERVISION_URL']
        if ($LASTEXITCODE -ne 0) { Detener 'No se pudo ajustar ngsw.json del shell (salida de arriba).' }
        Write-Host 'ok       ngsw.json con las direcciones de los microfrontends'
    }
}
Write-Host ''
Write-Host "Frontends publicados en $sitios (shell: $($envPl['ERP_URL']); portal: $($envPl['PORTAL_URL']))."

exit 0
