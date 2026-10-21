#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
docker compose up -d --build --wait
printf '%s\n' 'Open http://localhost:8080 or http://SERVER-IP:8080 from your phone.'
