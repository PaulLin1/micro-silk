#!/usr/bin/env bash
# Pushes the runtime env vars from .env to the linked Vercel project, for all
# three environments. Run after `npx vercel link`. Safe to re-run: it removes
# an existing value first.
#
#   bash scripts/push_vercel_env.sh
set -euo pipefail

VARS=(DATABASE_URL R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET)
ENVIRONMENTS=(production preview development)

# shellcheck disable=SC1091
set -a; source .env; set +a

for var in "${VARS[@]}"; do
  value="${!var:-}"
  if [ -z "$value" ]; then
    echo "! $var not set in .env — skipping"
    continue
  fi
  for env in "${ENVIRONMENTS[@]}"; do
    npx vercel env rm "$var" "$env" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | npx vercel env add "$var" "$env" >/dev/null
    echo "✓ $var -> $env"
  done
done

echo "Done. Redeploy for changes to take effect: npx vercel --prod"
