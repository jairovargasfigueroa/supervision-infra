# Genera las 10 fotos de avance de los datos de prueba (docs/datos-prueba.md, sección 10) con System.Drawing.
# 1600 x 1200 px, JPEG calidad 80, fondo por obra, un dibujo simple de la partida y el texto de muestra.
# Se corre una sola vez (Windows PowerShell 5.1) y las imágenes se suben al repo en {obraId}/{fotoId}.jpg.
# Uso: ./semilla/fotos/generar-fotos.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$ancho = 1600
$alto = 1200

# Color del cielo y del suelo por obra
$obras = @{
    1 = @{ Nombre = 'Edificio Residencial Las Palmeras'; Cielo = @(120, 170, 215); Suelo = @(150, 120, 90) }
    2 = @{ Nombre = 'Condominio Las Lomas'; Cielo = @(215, 160, 120); Suelo = @(165, 95, 60) }
    3 = @{ Nombre = 'Unidad Educativa Nueva Esperanza'; Cielo = @(150, 200, 160); Suelo = @(120, 140, 80) }
}

# Una fila por foto: obra, código de la partida, nombre, tipo de dibujo, número de foto
$fotos = @(
    @{ Obra = 1; Partida = 3; Codigo = 'P-03'; Nombre = 'Hormigón armado en columnas'; Dibujo = 'columnas'; N = 1 }
    @{ Obra = 1; Partida = 3; Codigo = 'P-03'; Nombre = 'Hormigón armado en columnas'; Dibujo = 'columnas'; N = 2 }
    @{ Obra = 1; Partida = 4; Codigo = 'P-04'; Nombre = 'Losa maciza de hormigón armado'; Dibujo = 'losa'; N = 1 }
    @{ Obra = 1; Partida = 4; Codigo = 'P-04'; Nombre = 'Losa maciza de hormigón armado'; Dibujo = 'losa'; N = 2 }
    @{ Obra = 1; Partida = 5; Codigo = 'P-05'; Nombre = 'Muro de ladrillo de 6 huecos'; Dibujo = 'muro'; N = 1 }
    @{ Obra = 1; Partida = 5; Codigo = 'P-05'; Nombre = 'Muro de ladrillo de 6 huecos'; Dibujo = 'muro'; N = 2 }
    @{ Obra = 2; Partida = 4; Codigo = 'P-04'; Nombre = 'Hormigón armado en columnas y vigas'; Dibujo = 'vigas'; N = 1 }
    @{ Obra = 2; Partida = 4; Codigo = 'P-04'; Nombre = 'Hormigón armado en columnas y vigas'; Dibujo = 'vigas'; N = 2 }
    @{ Obra = 3; Partida = 1; Codigo = 'P-01'; Nombre = 'Limpieza y replanteo del terreno'; Dibujo = 'replanteo'; N = 1 }
    @{ Obra = 3; Partida = 1; Codigo = 'P-01'; Nombre = 'Limpieza y replanteo del terreno'; Dibujo = 'replanteo'; N = 2 }
)

function Color([int[]]$rgb, [int]$delta = 0) {
    $c = $rgb | ForEach-Object { [Math]::Max(0, [Math]::Min(255, $_ + $delta)) }
    return [System.Drawing.Color]::FromArgb($c[0], $c[1], $c[2])
}

$hormigon = [System.Drawing.Color]::FromArgb(170, 170, 165)
$hormigonOscuro = [System.Drawing.Color]::FromArgb(125, 125, 120)
$fierro = [System.Drawing.Color]::FromArgb(110, 60, 40)
$ladrillo = [System.Drawing.Color]::FromArgb(178, 84, 50)
$madera = [System.Drawing.Color]::FromArgb(190, 150, 95)
$horizonte = 800

function Dibujar-Columnas($g, [int]$cantidad, [int]$altura) {
    $paso = [int](1300 / $cantidad)
    for ($i = 0; $i -lt $cantidad; $i++) {
        $x = 180 + $i * $paso
        $g.FillRectangle((New-Object System.Drawing.SolidBrush $hormigon), $x, $horizonte - $altura, 90, $altura)
        $g.DrawRectangle((New-Object System.Drawing.Pen $hormigonOscuro, 4), $x, $horizonte - $altura, 90, $altura)
        # Arranques de fierro sobre cada columna
        $pen = New-Object System.Drawing.Pen $fierro, 6
        foreach ($dx in 15, 40, 65, 80) { $g.DrawLine($pen, $x + $dx, $horizonte - $altura, $x + $dx, $horizonte - $altura - 120) }
    }
}

function Dibujar-Losa($g, [int]$avance) {
    # Columnas bajo la losa, puntales de madera y la losa (más larga en la foto 2)
    Dibujar-Columnas $g 6 360
    $pen = New-Object System.Drawing.Pen $madera, 10
    for ($x = 220; $x -lt 1500; $x += 110) { $g.DrawLine($pen, $x, $horizonte, $x, $horizonte - 330) }
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $madera), 150, $horizonte - 400, 1350, 40)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush $hormigon), 150, $horizonte - 450, $avance, 50)
    $g.DrawRectangle((New-Object System.Drawing.Pen $hormigonOscuro, 4), 150, $horizonte - 450, $avance, 50)
}

function Dibujar-Muro($g, [int]$hiladas) {
    $brocha = New-Object System.Drawing.SolidBrush $ladrillo
    $junta = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(215, 205, 190)), 4
    for ($fila = 0; $fila -lt $hiladas; $fila++) {
        $y = $horizonte - ($fila + 1) * 45
        $desfase = if ($fila % 2) { 60 } else { 0 }
        for ($x = 200 - $desfase; $x -lt 1400; $x += 120) {
            $x0 = [Math]::Max(200, $x)
            $w = [Math]::Min($x + 120, 1400) - $x0
            $g.FillRectangle($brocha, $x0, $y, $w, 45)
            $g.DrawRectangle($junta, $x0, $y, $w, 45)
        }
    }
}

function Dibujar-Vigas($g, [int]$tramos) {
    Dibujar-Columnas $g 5 420
    $paso = 260
    for ($i = 0; $i -lt $tramos; $i++) {
        $x = 180 + $i * $paso
        $g.FillRectangle((New-Object System.Drawing.SolidBrush $hormigon), $x, $horizonte - 480, $paso + 90, 60)
        $g.DrawRectangle((New-Object System.Drawing.Pen $hormigonOscuro, 4), $x, $horizonte - 480, $paso + 90, 60)
    }
}

function Dibujar-Replanteo($g, [int]$estacas) {
    # Estacas y lienzas sobre el terreno limpio
    $madero = New-Object System.Drawing.SolidBrush $madera
    $lienza = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 3
    $puntos = @()
    for ($i = 0; $i -lt $estacas; $i++) {
        $x = 200 + $i * [int](1200 / [Math]::Max(1, $estacas - 1))
        foreach ($y in 900, 1080) {
            $g.FillRectangle($madero, $x - 8, $y - 70, 16, 70)
            $puntos += , @($x, ($y - 60))
        }
    }
    for ($i = 0; $i -lt $estacas - 1; $i++) {
        foreach ($fila in 0, 1) {
            $a = $puntos[$i * 2 + $fila]; $b = $puntos[($i + 1) * 2 + $fila]
            $g.DrawLine($lienza, $a[0], $a[1], $b[0], $b[1])
        }
    }
    $g.DrawLine($lienza, $puntos[0][0], $puntos[0][1], $puntos[1][0], $puntos[1][1])
}

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$parametros = New-Object System.Drawing.Imaging.EncoderParameters 1
$parametros.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]80)

foreach ($foto in $fotos) {
    $obra = $obras[$foto.Obra]
    $obraId = 'b0000000-0000-4000-8000-00000000000{0}' -f $foto.Obra
    $fotoId = 'f1000000-0000-4000-8000-0000000{0}{1:D2}{2:D2}' -f $foto.Obra, $foto.Partida, $foto.N
    $carpeta = Join-Path $PSScriptRoot $obraId
    New-Item -ItemType Directory -Force $carpeta | Out-Null

    $imagen = New-Object System.Drawing.Bitmap $ancho, $alto
    $g = [System.Drawing.Graphics]::FromImage($imagen)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    # Cielo y suelo con degradado (la foto 2 un poco más clara)
    $luz = ($foto.N - 1) * 15
    $cielo = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 0, $ancho, $horizonte), (Color $obra.Cielo (40 + $luz)), (Color $obra.Cielo $luz), 90
    $g.FillRectangle($cielo, 0, 0, $ancho, $horizonte)
    $suelo = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, $horizonte, $ancho, ($alto - $horizonte)), (Color $obra.Suelo $luz), (Color $obra.Suelo (-40 + $luz)), 90
    $g.FillRectangle($suelo, 0, $horizonte, $ancho, $alto - $horizonte)

    switch ($foto.Dibujo) {
        'columnas' { Dibujar-Columnas $g (4 + $foto.N * 2) (300 + $foto.N * 120) }
        'losa' { Dibujar-Losa $g (500 + $foto.N * 400) }
        'muro' { Dibujar-Muro $g (4 + $foto.N * 4) }
        'vigas' { Dibujar-Vigas $g (2 + $foto.N) }
        'replanteo' { Dibujar-Replanteo $g (3 + $foto.N) }
    }

    # Franja con el texto de muestra
    $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(190, 20, 20, 20))), 0, 0, $ancho, 210)
    $titulo = New-Object System.Drawing.Font 'Segoe UI', 54, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $detalle = New-Object System.Drawing.Font 'Segoe UI', 38, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $blanco = [System.Drawing.Brushes]::White
    $g.DrawString('IMAGEN DE MUESTRA', $titulo, $blanco, 50, 30)
    $texto = '{0} · {1} {2} · foto {3}' -f $obra.Nombre, $foto.Codigo, $foto.Nombre, $foto.N
    $g.DrawString($texto, $detalle, $blanco, (New-Object System.Drawing.RectangleF 50, 110, ($ancho - 100), 90))

    $ruta = Join-Path $carpeta "$fotoId.jpg"
    $imagen.Save($ruta, $codec, $parametros)
    $g.Dispose(); $imagen.Dispose()
    Write-Host ('{0}  {1:N0} KB' -f $ruta.Substring($PSScriptRoot.Length + 1), ((Get-Item $ruta).Length / 1KB))
}
