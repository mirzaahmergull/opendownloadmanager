param([string]$YtDlpVersion = '2026.08.19')
$ErrorActionPreference = 'Stop'
$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host 'Downloading official yt-dlp Windows binary...'
Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpVersion/yt-dlp.exe" -OutFile (Join-Path $toolDir 'yt-dlp.exe')
Invoke-WebRequest "https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpVersion/SHA2-256SUMS" -OutFile (Join-Path $toolDir 'yt-dlp-SHA2-256SUMS.txt')
$checksums = Get-Content -LiteralPath (Join-Path $toolDir 'yt-dlp-SHA2-256SUMS.txt')
$expected = ($checksums | Where-Object { $_ -match '\s+yt-dlp\.exe$' } | Select-Object -First 1).Split(' ')[0].ToLower()
$actual = (Get-FileHash -LiteralPath (Join-Path $toolDir 'yt-dlp.exe') -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw 'yt-dlp checksum verification failed.' }
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
  $resolved = (Get-Item -LiteralPath $ffmpeg.Source).FullName
  Copy-Item -LiteralPath $resolved -Destination (Join-Path $toolDir 'ffmpeg.exe')
  $probe = Join-Path (Split-Path -Parent $resolved) 'ffprobe.exe'
  if (Test-Path -LiteralPath $probe) { Copy-Item -LiteralPath $probe -Destination (Join-Path $toolDir 'ffprobe.exe') }
  $ffmpegRoot = Split-Path -Parent (Split-Path -Parent $resolved)
  $licenseFolder = Join-Path $toolDir 'licenses'
  New-Item -ItemType Directory -Force $licenseFolder | Out-Null
  if (Test-Path -LiteralPath (Join-Path $ffmpegRoot 'LICENSE')) { Copy-Item -LiteralPath (Join-Path $ffmpegRoot 'LICENSE') -Destination (Join-Path $licenseFolder 'FFmpeg-LICENSE.txt') }
  if (Test-Path -LiteralPath (Join-Path $ffmpegRoot 'README.txt')) { Copy-Item -LiteralPath (Join-Path $ffmpegRoot 'README.txt') -Destination (Join-Path $licenseFolder 'FFmpeg-README.txt') }
} else {
  throw 'Install FFmpeg, put ffmpeg.exe and ffprobe.exe in this tools directory, and rerun setup.'
}
& (Join-Path $toolDir 'yt-dlp.exe') --version
Write-Host 'Video tools are ready.'
