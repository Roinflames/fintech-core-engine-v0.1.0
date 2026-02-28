#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

serve=false
skip_install=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --serve) serve=true; shift ;;
    --skip-install) skip_install=true; shift ;;
    --help|-h)
      printf 'Usage: %s [--serve] [--skip-install]\n' "$0"
      printf '  --serve         Start the dev server once migrations and build succeed.\n'
      printf '  --skip-install  Assume node_modules already exists and skip npm install.\n'
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if [[ -f .env ]]; then
  while IFS='=' read -r key value; do
    [[ -z $key ]] && continue
    [[ $key == \#* ]] && continue
    export "$key=$value"
  done < <(grep -v '^\s*$\|^\s*#' .env)
fi

if [[ "${skip_install}" != "true" ]]; then
  echo "Running npm install"
  npm install
fi

echo "Running migrations"
npm run migrate

echo "Running build"
npm run build

if [[ "${serve}" == "true" ]]; then
  echo "Starting NestJS dev server"
  npm run start:dev
  exit 0
fi

cat <<'EOF'
Setup complete. Remaining validations:
  - npm run start:dev         # start the server (runs on /v1 and /health)
  - npm run check:concurrency # runs the double-spend smoke (needs TENANT_ID / wallet ids)
  - Repeat npm run build && npm test -- --runInBand if you want additional guarantees

Open http://localhost:3000/api for Swagger and hit /v1/... endpoints.
EOF
