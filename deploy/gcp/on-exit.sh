#!/bin/bash
# systemd lo ejecuta al parar el servicio. $EXIT_STATUS lo pone systemd.
cd /opt/tavernus || exit 0
{ echo "code=${EXIT_STATUS:-?}"; echo "at=$(date +%s)"; tail -n 30 logs/bot.log; } > logs/last-exit.txt
