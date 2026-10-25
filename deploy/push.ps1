<#
  Sube la web al VPS y la reinicia, desde PowerShell en Windows (sin Git Bash).
  Hace lo mismo que deploy/push.sh; usa ssh, scp y tar, que vienen con Windows 10 y 11.

    .\deploy\push.ps1 -Setup -SetupArgs '--domain','tavernus.ejemplo.com'   primera vez
    .\deploy\push.ps1                    compila aquí, sube, instala, reinicia y comprueba salud
    .\deploy\push.ps1 -RemoteBuild       compila en el servidor
    .\deploy\push.ps1 -Test              pasa los tests antes de subir

  Servidor: variables de entorno o deploy\local.env (no se sube a git):
    TAVERNUS_HOST=usuario@203.0.113.7
    TAVERNUS_SSH_PORT=22
    TAVERNUS_SSH_KEY=C:\Users\yo\.ssh\id_ed25519   (opcional)
    TAVERNUS_SSH_OPTS=-o StrictHostKeyChecking=accept-new   (opcional, opciones extra de ssh/scp)

  Si PowerShell no deja ejecutar scripts:
    powershell -ExecutionPolicy Bypass -File deploy\push.ps1
#>
param(
  [switch]$Setup,
  [switch]$RemoteBuild,
  [switch]$Test,
  [string[]]$SetupArgs = @()
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$cfg = @{}
foreach ($k in 'TAVERNUS_HOST', 'TAVERNUS_SSH_PORT', 'TAVERNUS_SSH_KEY', 'TAVERNUS_SSH_OPTS') {
  $v = [Environment]::GetEnvironmentVariable($k)
  if ($v) { $cfg[$k] = $v }
}
if (Test-Path 'deploy\local.env') {
  foreach ($line in Get-Content 'deploy\local.env') {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$' -and -not $cfg.ContainsKey($Matches[1])) {
      $cfg[$Matches[1]] = $Matches[2].Trim('"', "'")
    }
  }
}
if (-not $cfg['TAVERNUS_HOST']) { throw 'Pon TAVERNUS_HOST=usuario@servidor (variable de entorno o deploy\local.env).' }
$hostName = $cfg['TAVERNUS_HOST']
$port = if ($cfg['TAVERNUS_SSH_PORT']) { $cfg['TAVERNUS_SSH_PORT'] } else { '22' }
$sshOpts = @('-p', $port, '-o', 'ServerAliveInterval=30')
$scpOpts = @('-P', $port)
if ($cfg['TAVERNUS_SSH_KEY']) { $sshOpts += @('-i', $cfg['TAVERNUS_SSH_KEY']); $scpOpts += @('-i', $cfg['TAVERNUS_SSH_KEY']) }
if ($cfg['TAVERNUS_SSH_OPTS']) { $extra = @($cfg['TAVERNUS_SSH_OPTS'] -split '\s+' | Where-Object { $_ }); $sshOpts += $extra; $scpOpts += $extra }
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
foreach ($cmd in 'ssh', 'scp') { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Falta $cmd (Configuración > Aplicaciones > Características opcionales > Cliente OpenSSH)." } }

function Invoke-Native([string]$exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe terminó con código $LASTEXITCODE" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("tavernus-push-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
# El comando remoto va sin comillas dobles: PowerShell 5.1 las rompe al pasarlas a ssh.exe.
$sudo = 'S=; [ $(id -u) = 0 ] || S=sudo'
try {
  if ($Setup) {
    Write-Host "[push] subiendo deploy/ a $hostName y preparando el servidor"
    $tgz = Join-Path $tmp 'deploy.tgz'
    Invoke-Native $tar @('-czf', $tgz, '--exclude=deploy/local.env', '--exclude=deploy/gcp', 'deploy')
    Invoke-Native 'scp' ($scpOpts + @($tgz, "${hostName}:/tmp/tavernus-deploy.tgz"))
    $extra = ($SetupArgs | ForEach-Object { $_ -replace '[^A-Za-z0-9@._:/=-]', '' }) -join ' '
    $remote = "set -e; $sudo; D=`$(mktemp -d); tar -xzf /tmp/tavernus-deploy.tgz -C `$D; rm -f /tmp/tavernus-deploy.tgz; " +
              "find `$D/deploy -type f -exec sed -i 's/\r`$//' {} +; `$S bash `$D/deploy/setup-vps.sh $extra; rm -rf `$D"
    Invoke-Native 'ssh' (@('-t') + $sshOpts + @($hostName, $remote))
    return
  }

  if ($Test) { Invoke-Native 'npm' @('test') }
  if (-not $RemoteBuild) {
    Write-Host '[push] compilando (npm run build)'
    if (Test-Path dist) { Remove-Item -Recurse -Force dist }
    Invoke-Native 'npm' @('run', 'build')
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Write-Host "[push] empaquetando la versión $stamp"
  $tgz = Join-Path $tmp 'release.tgz'
  # Lista explícita de lo que se sube: el tar de Windows (bsdtar) no ancla los --exclude.
  $items = @('package.json', 'package-lock.json', 'tsconfig.json', 'src', 'public', 'assets', 'deploy', 'docs', 'README.md')
  if (-not $RemoteBuild) { $items += 'dist' }
  $present = @($items | Where-Object { Test-Path $_ })
  Invoke-Native $tar (@('-czf', $tgz, '--exclude=deploy/local.env', '--exclude=*.log') + $present)
  Write-Host ("[push] subiendo {0:N1} MB a $hostName" -f ((Get-Item $tgz).Length / 1MB))
  Invoke-Native 'scp' ($scpOpts + @($tgz, "${hostName}:/tmp/tavernus-release.tgz"))

  $flag = if ($RemoteBuild) { ' --remote-build' } else { '' }
  $remote = "set -e; $sudo; R=/opt/tavernus/releases/$stamp; `$S mkdir -p `$R; `$S tar -xzf /tmp/tavernus-release.tgz -C `$R; " +
            "rm -f /tmp/tavernus-release.tgz; `$S find `$R/deploy -type f -exec sed -i 's/\r`$//' {} +; `$S bash `$R/deploy/release.sh $stamp$flag"
  Invoke-Native 'ssh' (@('-t') + $sshOpts + @($hostName, $remote))
  Write-Host "[push] hecho: versión $stamp"
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
