#!/usr/bin/env bash
#
# Tears down everything deploy.sh created, in reverse order.
#
#   ./destroy.sh            # asks first, shows what it will delete
#   ./destroy.sh --yes      # no prompt
#
# Reads .deploy-state.json for ids, and falls back to matching on STACK_NAME
# so it still works if that file was lost.

set -euo pipefail

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; RESET=""
fi

info() { printf "  %s\n" "$*"; }
ok()   { printf "  %s✓%s %s\n" "$GREEN" "$RESET" "$*"; }
die()  { printf "\n%s✗ %s%s\n\n" "$RED$BOLD" "$*" "$RESET" >&2; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE=".deploy-state.json"

[ -f .env ] || die ".env not found."
set -a; # shellcheck disable=SC1091
source .env; set +a

: "${STACK_NAME:=facility-tracker-demo}"
[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || die "DIGITALOCEAN_ACCESS_TOKEN is not set in .env"
export DIGITALOCEAN_ACCESS_TOKEN

command -v doctl >/dev/null || die "doctl is required."
command -v jq    >/dev/null || die "jq is required."

# Check the credential before anything else. An expired token used to sail
# through: every delete failed, each one reported "already gone", the state
# file was removed and the script printed "Gone." — while the database, the
# app and nine triggers kept running and billing, with the ids needed to
# find them now deleted.
doctl account get >/dev/null 2>&1 \
  || die "doctl cannot authenticate with DIGITALOCEAN_ACCESS_TOKEN.

  Nothing has been deleted. Fix the token in .env and re-run — the
  resource ids in $STATE_FILE are untouched."

state_get() { [ -f "$STATE_FILE" ] && jq -r --arg k "$1" '.[$k] // empty' "$STATE_FILE" || true; }

DB_CLUSTER_NAME="${STACK_NAME}-db"

app_id="$(state_get app_id)"
[ -n "$app_id" ] || app_id="$(doctl apps list --format ID,Spec.Name --no-header 2>/dev/null \
  | awk -v n="$STACK_NAME" '$2==n {print $1}' | head -1)"

db_id="$(state_get db_cluster_id)"
[ -n "$db_id" ] || db_id="$(doctl databases list --format ID,Name --no-header 2>/dev/null \
  | awk -v n="$DB_CLUSTER_NAME" '$2==n {print $1}' | head -1)"

# Every trigger this stack owns: the intake shards, reset, close and summary.
# Matched by name prefix rather than by a list of state keys — an earlier
# version named two keys explicitly and quietly left the reset trigger
# running, which is exactly the kind of leftover a teardown script exists to
# prevent.
trigger_rows="$(doctl harness-runtime triggers list --output json 2>/dev/null \
  | jq -r --arg p "${STACK_NAME}-" '.[]? | select(.name | startswith($p)) | "\(.trigger_id // .id) \(.name)"' \
  | sort -k2 || true)"

printf "\n%sThis will permanently delete:%s\n\n" "$BOLD$RED" "$RESET"
[ -n "$trigger_rows" ] && while read -r t_id t_name; do
  [ -n "$t_id" ] && info "trigger          ${t_name}  ($t_id)"
done <<< "$trigger_rows"
[ -n "$app_id" ]     && info "app              ${STACK_NAME}          ($app_id)"
[ -n "$db_id" ]      && info "database         ${DB_CLUSTER_NAME}     ($db_id)  ${RED}and every ticket in it${RESET}"

if [ -z "$trigger_rows$app_id$db_id" ]; then
  printf "\n  Nothing found for stack '%s'. Nothing to do.\n\n" "$STACK_NAME"
  exit 0
fi

if [ "${1:-}" != "--yes" ] && [ "${1:-}" != "-y" ]; then
  printf "\n  Type the stack name to confirm: "
  read -r reply
  [ "$reply" = "$STACK_NAME" ] || die "Did not match. Nothing deleted."
fi

printf "\n"

failures=0

# Three outcomes, not two: deleted, genuinely absent, and failed. The old
# code was `... || info "already gone"`, which reported a 403, a network
# error and a rate limit exactly like a 404, and discarded stderr so the
# real reason was never shown.
del() {
  local what="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    ok "deleted $what"
  elif printf '%s' "$out" | grep -qiE '404|not found|does not exist'; then
    info "$what already gone"
  else
    failures=$((failures + 1))
    printf "  %s✗%s could not delete %s\n" "$RED" "$RESET" "$what"
    printf "      %s\n" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-160)"
  fi
}

[ -n "$trigger_rows" ] && while read -r t_id t_name; do
  [ -n "$t_id" ] || continue
  del "trigger $t_name" doctl harness-runtime triggers delete "$t_id" --force
done <<< "$trigger_rows"
[ -n "$app_id" ] && del "app ${STACK_NAME}"        doctl apps delete "$app_id" --force
[ -n "$db_id" ]  && del "database ${DB_CLUSTER_NAME}" doctl databases delete "$db_id" --force

# Keep the state file when anything failed. It holds every resource id, and
# deleting it after a failed teardown is what turns a recoverable problem
# into hunting through the control panel.
if [ "$failures" -gt 0 ]; then
  printf "\n  %s%s resource(s) could not be deleted — the stack is NOT gone.%s\n\n" \
    "$RED$BOLD" "$failures" "$RESET"
  info "Keeping $STATE_FILE so the ids are not lost."
  info "Fix the cause above and re-run; deleting what is already deleted is safe."
  printf "\n"
  exit 1
fi

[ -f "$STATE_FILE" ] && rm -f "$STATE_FILE" && ok "cleared .deploy-state.json"

printf "\n  %sGone.%s Sessions already run are billed; nothing further will start.\n\n" "$BOLD" "$RESET"
