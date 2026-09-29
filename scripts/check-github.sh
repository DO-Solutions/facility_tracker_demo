#!/usr/bin/env bash
#
# Report whether the GitHub integration is actually working.
#
# Two wrong ways to answer this, both tried:
#
#   Read the connection's `status` field. It said `active` for two days while
#   every tool call failed — the record and the OAuth token behind it expire
#   independently.
#
#   Spin up a probe session and call a tool. A session created with
#   `harness-runtime create` runs as actor `<username>`; a session started by
#   a *trigger* runs as the DigitalOcean account UUID. They resolve different
#   connections, so a probe can pass while the demo is broken. That is worse
#   than the status field, because it looks rigorous.
#
# What is left is evidence from the real actor: the webhook trigger's own
# execution history. Free, accurate, and it reports the last observed truth
# rather than a guess.
#
# Exit 0 working, 1 broken, 2 unknown (no run has attempted it yet).

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[ -f .env ] || { echo "no .env" >&2; exit 2; }
set -a; . ./.env; set +a
[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || { echo "DIGITALOCEAN_ACCESS_TOKEN not set" >&2; exit 2; }
export DIGITALOCEAN_ACCESS_TOKEN

# Every intake shard, not just the first. Complaints are round-robined, so
# the most recent GitHub attempt can be on any of them and shard 1 may have
# been idle for a while.
triggers="$(jq -r 'to_entries[] | select(.key | test("^webhook_trigger_id(_[0-9]+)?$")) | .value | select(. != "")' \
  .deploy-state.json 2>/dev/null || true)"
[ -n "$triggers" ] || { echo "no webhook trigger in .deploy-state.json — deploy first" >&2; exit 2; }

# Pair each execution with the trigger it belongs to, newest first, so
# get-execution below is asked about the right one.
pairs="$(for t in $triggers; do
  doctl harness-runtime triggers list-executions "$t" --output json 2>/dev/null \
    | jq -r --arg t "$t" '.[]? | "\(.created_at) \($t) \(.execution_id)"' || true
done | sort -r | head -5)"
[ -n "$pairs" ] || { echo "no trigger runs yet — submit a complaint, then re-run this" >&2; exit 2; }

while read -r _ trigger id; do
  [ -n "$id" ] || continue
  out="$(doctl harness-runtime triggers get-execution "$trigger" "$id" --output json 2>/dev/null \
    | jq -r 'if type=="array" then .[0] else . end | .output_text // ""')"

  # Look at what the tool returned, not at how the agent described it. The
  # agent's prose says "authorize" either way, which is how a naive grep
  # reports success for a failure.
  if printf '%s' "$out" | grep -q 'requires an OAuth connection'; then
    echo "not authorized — the last run that tried could not reach GitHub"
    exit 1
  fi
  if printf '%s' "$out" | grep -qE 'github_create_issue.*"number"|html_url'; then
    echo "working — the last run filed an issue"
    exit 0
  fi
done <<< "$pairs"

echo "unknown — no recent run attempted the GitHub step"
exit 2
