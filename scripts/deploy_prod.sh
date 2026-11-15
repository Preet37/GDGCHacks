#!/usr/bin/env bash
# Deploy `origin/main` to production from this laptop: Cloud Run `tutor-api` first as a no-traffic
# candidate, checked, then promoted; then Firebase Hosting. Run from anywhere:  ./scripts/deploy_prod.sh
#
#   ./scripts/deploy_prod.sh            # server + page
#   ./scripts/deploy_prod.sh server     # only Cloud Run
#   ./scripts/deploy_prod.sh page       # only Hosting
#
# Needs (once): `gcloud auth login` and `firebase login` as an account with Editor on tutor-1098c.
# It never changes the service's environment (the Gemini key and model on Cloud Run stay as they are),
# and it builds from a clean checkout of origin/main, so the dev page running in this folder is untouched.
set -euo pipefail
export PATH="/opt/homebrew/share/google-cloud-sdk/bin:$PATH"
PROJECT=tutor-1098c
REGION=us-central1
SERVICE=tutor-api
WHAT="${1:-all}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)/main"

say() { printf '\n== %s\n' "$*"; }

gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q . || { echo "not signed in: run  gcloud auth login"; exit 1; }

say "clean checkout of origin/main"
git -C "$REPO" fetch -q origin main
git -C "$REPO" worktree add -q --detach "$WORK" origin/main
trap 'git -C "$REPO" worktree remove --force "$WORK" >/dev/null 2>&1 || true' EXIT
COMMIT="$(git -C "$WORK" rev-parse --short HEAD)"
echo "deploying $COMMIT"

if [ "$WHAT" = all ] || [ "$WHAT" = server ]; then
  say "server tests (offline)"
  ( cd "$WORK/server" && "$REPO/server/.venv/bin/python" -m pytest -q -k "not live" | tail -1 )

  say "Cloud Run: candidate revision, no traffic"
  gcloud run deploy "$SERVICE" --source "$WORK/server" --region "$REGION" --project "$PROJECT" --no-traffic --tag cand --quiet
  CAND="$(gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" --format=json | python3 -c "import sys,json; print(next(t['url'] for t in json.load(sys.stdin)['status']['traffic'] if t.get('tag')=='cand'))")"
  echo "candidate: $CAND"

  say "candidate checks"
  for i in 1 2 3; do curl -fsS -m 30 "$CAND/api/health" >/dev/null; done; echo "health ok x3"
  curl -fsS -m 30 "$CAND/api/debug/usage" >/dev/null && echo "usage ok"
  code="$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST "$CAND/api/check" -H 'Content-Type: application/json' -d '{"image_base64":"xx","mode":"auto","state":{"page_id":"deploy-check"}}')"
  [ "$code" = 400 ] && echo "bad image -> 400 ok" || { echo "bad image returned $code, expected 400: NOT promoting"; exit 1; }
  # one real check (about 21k input tokens): a wrong derivative must come back with a mark
  ( cd "$REPO/server" && .venv/bin/python - "$CAND" <<'PY'
import base64, json, sys, urllib.request
sys.path.insert(0, ".")
import testpage
img = base64.b64encode(testpage.page(["f(x) = 3x^2 + 2x", "f'(x) = 6x + 1"])).decode()
req = urllib.request.Request(sys.argv[1] + "/api/check", json.dumps({"image_base64": img, "mode": "auto", "state": {"page_id": "deploy-check"}}).encode(), {"Content-Type": "application/json"})
r = json.loads(urllib.request.urlopen(req, timeout=90).read())
kinds = [a["type"] for a in r["actions"]]
print("real check:", kinds)
sys.exit(0 if "circle" in kinds or "underline" in kinds else 1)
PY
  ) || { echo "the real check did not mark the mistake: NOT promoting"; exit 1; }

  say "promote"
  gcloud run services update-traffic "$SERVICE" --to-latest --region "$REGION" --project "$PROJECT" --quiet >/dev/null
  curl -fsS -m 30 "https://tutor-1098c.web.app/api/health" && echo "  <- live health"
fi

if [ "$WHAT" = all ] || [ "$WHAT" = page ]; then
  say "Hosting (builds web/ in the clean checkout)"
  ( cd "$WORK" && firebase deploy --only hosting --project "$PROJECT" --non-interactive )
  curl -fsS -m 30 -o /dev/null -w 'live page %{http_code}\n' https://tutor-1098c.web.app/
fi

say "done: $COMMIT is live"
