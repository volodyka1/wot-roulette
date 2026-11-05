# Локальный сервер рулетки: http://localhost:8080/
# - отдаёт index.html (панель управления) и оверлей для OBS (index.html?obs=1)
# - /api/state: панель шлёт сюда результат прокрутки, оверлей в OBS его забирает
# - нужен и для входа через Wargaming (OpenID редиректит обратно на http-адрес)
param([int]$Port = 8080, [switch]$NoBrowser)

$root = $PSScriptRoot
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.json' = 'application/json; charset=utf-8'; '.mp3' = 'audio/mpeg'; '.wav' = 'audio/wav'
}
$script:state = ''

function Send-Bytes($res, [byte[]]$bytes, $type) {
  $res.ContentType = $type
  $res.ContentLength64 = $bytes.Length
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Invoke-Request($ctx) {
  $req = $ctx.Request
  $res = $ctx.Response
  $res.Headers.Add('Cache-Control', 'no-store')
  $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))

  if ($rel -eq 'api/state') {
    if ($req.HttpMethod -eq 'POST') {
      $reader = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)
      $script:state = $reader.ReadToEnd()
      $reader.Close()
      $res.StatusCode = 204
    } elseif ($script:state) {
      Send-Bytes $res ([Text.Encoding]::UTF8.GetBytes($script:state)) 'application/json; charset=utf-8'
    } else {
      $res.StatusCode = 204
    }
    return
  }

  if (-not $rel) { $rel = 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
  if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
    $ext = [IO.Path]::GetExtension($file).ToLower()
    $type = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
    Send-Bytes $res ([IO.File]::ReadAllBytes($file)) $type
  } else {
    $res.StatusCode = 404
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Рулетка запущена: http://localhost:$Port/"
Write-Host "Оверлей для OBS:  http://localhost:$Port/?obs=1"
Write-Host "Не закрывай это окно, пока идёт стрим (Ctrl+C чтобы остановить)."
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try { Invoke-Request $ctx } catch { Write-Host "Ошибка запроса: $_" }
    try { $ctx.Response.Close() } catch {}
  }
} finally {
  $listener.Stop()
}
