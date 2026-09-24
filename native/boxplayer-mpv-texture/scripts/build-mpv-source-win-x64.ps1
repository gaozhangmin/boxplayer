# Build a shared libmpv from the official mpv source in a native x64
# Windows developer shell with x64 FFmpeg, libass and libplacebo dependencies.
$ErrorActionPreference = 'Stop'
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'Run in a native Windows x64 developer shell.' }

$packageDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tag = 'v0.41.0'
$buildRoot = if ($env:MPV_BUILD_ROOT) { $env:MPV_BUILD_ROOT } else { Join-Path $packageDir '.mpv-source\x64' }
$sourceDir = Join-Path $buildRoot 'mpv'
$buildDir = Join-Path $buildRoot 'meson-build'
$prefix = Join-Path $buildRoot 'install'
$sdkDir = Join-Path $packageDir 'deps\mpv\win32\x64'
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
if ($LASTEXITCODE -ne 0 -or $actualTag -ne $tag) { throw "Expected mpv $tag in $sourceDir" }

$env:CC = 'clang'
$env:CXX = 'clang++'
$env:CC_LD = 'lld'
$env:CXX_LD = 'lld'
$env:WINDRES = 'llvm-rc'
if (-not (Test-Path (Join-Path $buildDir 'build.ninja'))) {
  & meson setup $buildDir $sourceDir --prefix $prefix -Dlibmpv=true -Dcplayer=false -Ddefault_library=shared -Dgpl=false
  if ($LASTEXITCODE -ne 0) { throw 'mpv Meson setup failed; check x64 dependencies and toolchain' }
}
& meson compile -C $buildDir
if ($LASTEXITCODE -ne 0) { throw 'mpv shared-library build failed' }
& meson install -C $buildDir
if ($LASTEXITCODE -ne 0) { throw 'mpv install failed' }

$dll = Get-ChildItem $prefix -Recurse -File -Filter 'libmpv-2.dll' | Select-Object -First 1
$importLibrary = Get-ChildItem $prefix -Recurse -File -Include 'mpv.lib', 'libmpv.lib' | Select-Object -First 1
if (-not $dll -or -not $importLibrary) { throw 'Shared libmpv or MSVC-compatible import library missing' }
Copy-Item $dll.FullName (Join-Path $sdkDir 'libmpv-2.dll')
Copy-Item $importLibrary.FullName (Join-Path $sdkDir 'mpv.lib')
Copy-Item (Join-Path $prefix 'include\mpv\*.h') $headerDir
Write-Host "Staged official mpv $tag x64 SDK at $sdkDir"
