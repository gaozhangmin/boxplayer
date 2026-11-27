param(
    [Parameter(Mandatory)][string] $TauriDriver,
    [Parameter(Mandatory)][string] $EdgeDriver,
    [Parameter(Mandatory)][string] $Node,
    [Parameter(Mandatory)][string] $OutputDir,
    [Parameter(Mandatory)][string] $DataDir
)

$ErrorActionPreference = 'Stop'
$user = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($user)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run the WebView2 test without administrator privileges'
}

$env:BOXPLAYER_L2_OUT_DIR = $OutputDir
$env:BOXPLAYER_DEV_DATA_DIR = $DataDir
$driver = Start-Process -FilePath $TauriDriver -ArgumentList '--port', '4444', '--native-driver', ('"{0}"' -f $EdgeDriver) `
    -PassThru -NoNewWindow -RedirectStandardOutput "$OutputDir/tauri-driver.log" -RedirectStandardError "$OutputDir/tauri-driver-error.log"
try {
    & $Node "$PSScriptRoot/ci-tauri-native-l2.mjs" --mode windows-webdriver 2>&1 |
        Tee-Object -FilePath "$OutputDir/test.log"
    exit $LASTEXITCODE
} finally {
    Stop-Process -Id $driver.Id -ErrorAction SilentlyContinue
    $appLogs = Join-Path $DataDir 'logs'
    if (Test-Path $appLogs) {
        Copy-Item $appLogs "$OutputDir/app-logs" -Recurse
    }
}
