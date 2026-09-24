# Build a shared libmpv from official mpv sources in a native Windows ARM64
# Clang/Windows SDK developer shell. Dependency installation is intentionally
# external: Meson must find ARM64 FFmpeg, libass, libplacebo and other mpv deps.
$ErrorActionPreference = 'Stop'

if ($env:PROCESSOR_ARCHITECTURE -ne 'ARM64') {
  throw 'Run this script in a native Windows ARM64 developer shell.'
}

$packageDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tag = if ($env:MPV_TAG) { $env:MPV_TAG } else { 'v0.41.0' }
$buildRoot = if ($env:MPV_BUILD_ROOT) { $env:MPV_BUILD_ROOT } else { Join-Path $packageDir '.mpv-source\arm64' }
$sourceDir = Join-Path $buildRoot 'mpv'
$buildDir = Join-Path $buildRoot 'meson-build'
$prefix = Join-Path $buildRoot 'install'
$sdkDir = Join-Path $packageDir 'deps\mpv\win32\arm64'
$headerDir = Join-Path $packageDir 'deps\mpv\include\mpv'

foreach ($tool in @('git', 'meson', 'ninja', 'clang', 'llvm-rc')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Missing build tool: $tool" }
}

New-Item -ItemType Directory -Force -Path $buildRoot, $sdkDir, $headerDir | Out-Null
if (-not (Test-Path (Join-Path $sourceDir '.git'))) {
  & git clone --depth 1 --branch $tag https://github.com/mpv-player/mpv.git $sourceDir
  if ($LASTEXITCODE -ne 0) { throw 'Unable to clone official mpv source' }
}
$actualTag = & git -C $sourceDir describe --tags --exact-match HEAD
if ($LASTEXITCODE -ne 0 -or $actualTag -ne $tag) { throw "Expected mpv $tag in $sourceDir; use another MPV_BUILD_ROOT" }

$env:CC = 'clang'
$env:CXX = 'clang++'
$env:CC_LD = 'lld'
$env:CXX_LD = 'lld'
$env:WINDRES = 'llvm-rc'
if (-not (Test-Path (Join-Path $buildDir 'build.ninja'))) {
  & meson setup $buildDir $sourceDir --prefix $prefix -Dlibmpv=true -Dcplayer=false -Ddefault_library=shared -Dgpl=false
  if ($LASTEXITCODE -ne 0) { throw 'mpv Meson setup failed; check ARM64 dependencies and toolchain' }
}
& meson compile -C $buildDir libmpv-2.dll
if ($LASTEXITCODE -ne 0) { throw 'mpv shared-library build failed' }
& meson install -C $buildDir
if ($LASTEXITCODE -ne 0) { throw 'mpv install failed' }

$dll = Get-ChildItem $prefix -Recurse -File -Filter 'libmpv-2.dll' | Select-Object -First 1
$importLibrary = Get-ChildItem $prefix -Recurse -File -Include 'mpv.lib', 'libmpv.lib' | Select-Object -First 1
if (-not $dll -or -not $importLibrary) {
  throw 'Shared libmpv or MSVC-compatible import library missing. Do not package a DLL without its matching import library.'
}
Copy-Item $dll.FullName (Join-Path $sdkDir 'libmpv-2.dll')
Copy-Item $importLibrary.FullName (Join-Path $sdkDir 'mpv.lib')
Copy-Item (Join-Path $prefix 'include\mpv\*.h') $headerDir
Write-Host "Staged official mpv $tag ARM64 SDK at $sdkDir"
Write-Host 'Next: pnpm --dir native/boxplayer-mpv-texture run build:libmpv'
