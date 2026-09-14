#!/bin/bash
# Se ejecuta UNA vez en la VM (como root): Node, usuario, swap, servicio y copias diarias.
set -euo pipefail
apt-get update -y && apt-get install -y curl ca-certificates
# Node 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
# 1 GB de swap: la e2-micro tiene 1 GB de RAM y npm/tsc lo necesitan al compilar
if [ ! -f /swapfile ]; then fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
id tavernus >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/tavernus --shell /usr/sbin/nologin tavernus
mkdir -p /opt/tavernus/logs /opt/tavernus/backups
chown -R tavernus:tavernus /opt/tavernus
# Copia diaria de la partida (7 días de historial)
cat > /etc/cron.daily/tavernus-backup <<'CRON'
#!/bin/bash
cd /opt/tavernus && tar czf backups/data-$(date +%F).tgz data && find backups -name 'data-*.tgz' -mtime +7 -delete
CRON
chmod +x /etc/cron.daily/tavernus-backup
echo "setup ok: node $(node -v)"
