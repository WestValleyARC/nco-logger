#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export APP_REVISION
APP_REVISION="$(git rev-parse --short HEAD 2>/dev/null || printf 'workspace')"

docker compose up -d --build --wait app
docker compose exec -T app node -e \
  "fetch('http://127.0.0.1:3000/readyz').then(async response => { console.log(await response.text()); if (!response.ok) process.exit(1); }).catch(error => { console.error(error.message); process.exit(1); })"

echo "Running revision ${APP_REVISION}. Browser JavaScript will revalidate automatically."
