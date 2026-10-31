<#
  Sube la web al VPS y la reinicia, desde PowerShell en Windows (sin Git Bash).
  Hace lo mismo que deploy/push.sh; usa ssh, scp y tar, que vienen con Windows 10 y 11.

    .\deploy\push.ps1 -Setup -SetupArgs '--domain','tavernus.ejemplo.com'   primera vez
    .\deploy\push.ps1 -Ops               instala scripts de operación y unidades (como administrador)
    .\deploy\push.ps1                    compila aquí, sube, instala, reinicia y comprueba salud
    .\deploy\push.ps1 -RemoteBuild       compila en el servidor
    .\deploy\push.ps1 -Test              pasa los tests antes de subir

  Servidor: variables de entorno o deploy\local.env (no se sube a git):
    TAVERNUS_HOST=tavernus@203.0.113.7   (tavernus despliega sin root; vale también root o un usuario con sudo)
    TAVERNUS_SSH_PORT=22
    TAVERNUS_SSH_KEY=C:\Users\yo\.ssh\tavernus_pc   (opcional)
    TAVERNUS_SSH_OPTS=-o StrictHostKeyChecking=accept-new   (opcional, opciones extra de ssh/scp)
    TAVERNUS_ADMIN_HOST=root@203.0.113.7 y TAVERNUS_ADMIN_SSH_KEY   (para -Setup y -Ops)
  Preparar o rotar el usuario tavernus (--usuario-deploy) solo está en deploy/push.sh (Git Bash).

  Si PowerShell no deja ejecutar scripts:
    powershell -ExecutionPolicy Bypass -File deploy\push.ps1
#>
param(
  [switch]$Setup,
  [switch]$Ops,
  [switch]$RemoteBuild,
  [switch]$Test,
  [string[]]$SetupArgs = @()
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$cfg = @{}
foreach ($k in 'TAVERNUS_HOST', 'TAVERNUS_SSH_PORT', 'TAVERNUS_SSH_KEY', 'TAVERNUS_SSH_OPTS', 'TAVERNUS_ADMIN_HOST', 'TAVERNUS_ADMIN_SSH_KEY') {
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
$adminHost = if ($cfg['TAVERNUS_ADMIN_HOST']) { $cfg['TAVERNUS_ADMIN_HOST'] } else { $hostName }
$adminKey = if ($cfg['TAVERNUS_ADMIN_SSH_KEY']) { $cfg['TAVERNUS_ADMIN_SSH_KEY'] } else { $cfg['TAVERNUS_SSH_KEY'] }
$sshOpts = @('-p', $port, '-o', 'ServerAliveInterval=30')
$scpOpts = @('-P', $port)
if ($cfg['TAVERNUS_SSH_OPTS']) { $extra = @($cfg['TAVERNUS_SSH_OPTS'] -split '\s+' | Where-Object { $_ }); $sshOpts += $extra; $scpOpts += $extra }
$adminSshOpts = $sshOpts; $adminScpOpts = $scpOpts
if ($cfg['TAVERNUS_SSH_KEY']) { $sshOpts += @('-i', $cfg['TAVERNUS_SSH_KEY']); $scpOpts += @('-i', $cfg['TAVERNUS_SSH_KEY']) }
if ($adminKey) { $adminSshOpts += @('-i', $adminKey); $adminScpOpts += @('-i', $adminKey) }
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
foreach ($cmd in 'ssh', 'scp') { if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Falta $cmd (Configuración > Aplicaciones > Características opcionales > Cliente OpenSSH)." } }

function Invoke-Native([string]$exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe terminó con código $LASTEXITCODE" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("tavernus-push-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
# El comando remoto va sin comillas dobles: PowerShell 5.1 las rompe al pasarlas a ssh.exe.
# sudo solo si el usuario no es root ni tavernus (tavernus usa su sudo limitado dentro de release.sh).
$sudo = 'S=; case $(id -un) in root|tavernus) ;; *) S=sudo ;; esac'
try {
  if ($Setup -or $Ops) {
    # Como administrador (root o sudo), con el deploy/ de aquí.
    Write-Host "[push] subiendo deploy/ a $adminHost"
    $tgz = Join-Path $tmp 'deploy.tgz'
    $up = '/tmp/tavernus-deploy-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.tgz'
    Invoke-Native $tar @('-czf', $tgz, '--exclude=deploy/local.env', 'deploy')
    Invoke-Native 'scp' ($adminScpOpts + @($tgz, "${adminHost}:$up"))
    if ($Ops) { $run = '$D/deploy/install-ops.sh $D/deploy' }
    else {
      $extra = ($SetupArgs | ForEach-Object { $_ -replace '[^A-Za-z0-9@._:/=-]', '' }) -join ' '
      $run = '$D/deploy/setup-vps.sh ' + $extra
    }
    $remote = "set -e; $sudo; D=`$(mktemp -d); tar -xzf $up -C `$D; rm -f $up; " +
              "find `$D/deploy -type f -exec sed -i 's/\r`$//' {} +; `$S bash $run; rm -rf `$D"
    Invoke-Native 'ssh' (@('-t') + $adminSshOpts + @($adminHost, $remote))
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
  # Un nombre por versión: root y tavernus no chocan con un fichero que el otro dejara a medias.
  $up = "/tmp/tavernus-release-$stamp.tgz"
  Invoke-Native 'scp' ($scpOpts + @($tgz, "${hostName}:$up"))

  $flag = if ($RemoteBuild) { ' --remote-build' } else { '' }
  $remote = "set -e; $sudo; R=/opt/tavernus/releases/$stamp; `$S mkdir -p `$R; `$S tar -xzf $up -C `$R; " +
            "rm -f $up; `$S find `$R/deploy -type f -exec sed -i 's/\r`$//' {} +; `$S bash `$R/deploy/release.sh $stamp$flag"
  # La clave de tavernus lleva «restrict» (sin terminal) y no le hace falta: su sudo no pide nada.
  $tty = if ($hostName -like 'tavernus@*') { @() } else { @('-t') }
  Invoke-Native 'ssh' ($tty + $sshOpts + @($hostName, $remote))
  Write-Host "[push] hecho: versión $stamp"
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
