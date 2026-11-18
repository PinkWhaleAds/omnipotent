#!/usr/bin/env bash
#
# Make a fresh clone runnable, in one command: secrets, dependencies, `.env`, containers, schema.
#
# Idempotent: on a machine already set up it only brings things in step, so it is also the answer to
# « the API no longer starts » after a reboot or a `docker compose down` emptied the secret store.
#
# What it needs beforehand is in `docs/nouveau-poste.md`: the tools, and the AWS profile `omnilor`,
# which is where the development secrets live.
#
# Usage, from backend/:  pnpm setup:dev
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

missing=()
for tool in aws docker node pnpm python3; do
  command -v "$tool" >/dev/null || missing+=("$tool")
done
if ((${#missing[@]} > 0)); then
  echo "Missing: ${missing[*]}. Install them first (docs/nouveau-poste.md § 1)." >&2
  exit 1
fi

echo "== Secrets, from AWS (and the token that installs the omnipass package)"
bash scripts/seed-local-secrets.sh

echo
echo "== Dependencies"
pnpm install --frozen-lockfile

echo
echo "== .env"
if [[ -f .env ]]; then
  echo "  kept: .env already exists"
else
  cp .env.example .env
  echo "  created from .env.example"
fi

echo
echo "== Containers: PostgreSQL 5442, S3 9012, secret store 9022"
docker compose up -d --wait postgres rustfs moto

echo
echo "== Schema"
pnpm migration:run

echo
echo "Ready. Start the API with: pnpm start:dev — then open http://localhost:3002/documentation"
