#!/usr/bin/env bash
# Deploy the ENGINEERING branch server to its own Cloud Run service, "tutor-api-eng" (never "tutor-api",
# which is the live site judges use). Run from anywhere: ./server/deploy_eng.sh
# Needs: gcloud auth login, gcloud config set project <id>, and server/.env with GEMINI_API_KEY and GEMINI_MODEL.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "server/.env not found (copy .env.example and fill it in)" >&2
  exit 1
fi

# KEY=VALUE lines from .env, comments/blank lines skipped, joined with commas. PORT is reserved by Cloud Run.
ENV_VARS=$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env | grep -v '^PORT=' | paste -sd, -)
if [ -z "$ENV_VARS" ]; then
  echo "server/.env has no KEY=VALUE lines" >&2
  exit 1
fi

gcloud run deploy tutor-api-eng \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "$ENV_VARS"
