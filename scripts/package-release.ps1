$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifestPath = Join-Path $projectRoot "manifest.json"
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath |
  ConvertFrom-Json
$version = $manifest.version
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$stagingRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $releaseRoot ".staging-v$version")
)
$archivePath = Join-Path $releaseRoot "mobalytics-poe-translate-v$version.zip"
$checksumPath = "$archivePath.sha256"

if (-not $stagingRoot.StartsWith($releaseRoot + [System.IO.Path]::DirectorySeparatorChar)) {
  throw "Refusing to use a staging directory outside the release directory."
}

$runtimeFiles = @(
  "manifest.json",
  "src\translation-core.js",
  "src\stat-translation.js",
  "src\page-context.js",
  "src\guide-prose.js",
  "src\llm.js",
  "src\llm-cache.js",
  "src\background.js",
  "src\content.js",
  "data\poe1-skill-gems.js",
  "data\poe1-core.js",
  "data\poe1-extended.js",
  "popup\popup.html",
  "popup\popup.css",
  "popup\popup.js",
  "popup\options.html",
  "popup\options.js",
  "icons\icon-16.png",
  "icons\icon-32.png",
  "icons\icon-48.png",
  "icons\icon-128.png"
)

foreach ($relativePath in $runtimeFiles) {
  $source = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Missing release file: $relativePath"
  }
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
if (Test-Path -LiteralPath $stagingRoot) {
  Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stagingRoot | Out-Null

foreach ($relativePath in $runtimeFiles) {
  $source = Join-Path $projectRoot $relativePath
  $destination = Join-Path $stagingRoot $relativePath
  $destinationDirectory = Split-Path -Parent $destination
  New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination
}

if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $archivePath `
  -CompressionLevel Optimal

$archiveStream = [System.IO.File]::OpenRead($archivePath)
$hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
try {
  $hash = [System.BitConverter]::ToString($hashAlgorithm.ComputeHash($archiveStream)).Replace("-", "").ToLowerInvariant()
}
finally {
  $archiveStream.Dispose()
  $hashAlgorithm.Dispose()
}
$checksum = "$hash  $([System.IO.Path]::GetFileName($archivePath))`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($checksumPath, $checksum, $utf8NoBom)

Remove-Item -LiteralPath $stagingRoot -Recurse -Force

Write-Output "Created: $archivePath"
Write-Output "SHA256: $hash"
