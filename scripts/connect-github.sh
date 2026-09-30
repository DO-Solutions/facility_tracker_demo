#!/usr/bin/env bash
#
# Authorize the GitHub connection that Action Gateway uses to file issues.
#
#   ./scripts/connect-github.sh
#
# Prints a one-time authorization URL and verification code. Open the URL,
# approve, and the agents can create issues — no GitHub token ever reaches
# the sandbox.
#
# Why this needs a human: OAuth. deploy.sh can create every other resource
# unattended, but not this.
#
#   ./scripts/connect-github.sh --force   revoke and re-authorize
#
# Why --force exists. The connection record and the underlying GitHub token
# expire independently: the token can go stale while the record still reports
# "active", and the API refuses to mint a new authorization link for a
# connection it believes is fine. The symptom is tool calls failing with
# "requires an OAuth connection" while everything here looks healthy, and
# issues silently never appearing.
#
# --force DELETEs the connection first, which returns it to `revoked`, after
# which a POST issues a link again. That is the only call that breaks the
# deadlock — there is no "refresh" and no way to ask for a link while the
# record claims to be healthy.
#
# It is destructive by design: between the revoke and your click, no agent
# can file an issue. The agent's own run output also carries a fresh connect
# link on failure, so if a run is in flight, that link is the cheaper route.
#
# The actor is the subtle part. Action Gateway resolves a connection by
# actor id, and a connection authorized against any other actor is invisible
# to the demo — the only symptom is issues silently never appearing.
#
# A trigger-started session runs as your DigitalOcean **username**. It has
# not always: the Action Gateway session list shows every trigger session
# through 2026-09-26 with the account UUID as actor, and every one from
# 2026-09-28 on with the username. The platform changed underneath the demo.
# This script targeted the UUID until 2026-09-29 and, after the switch, kept
# reporting "already authorized" against a connection nothing used, while
# every run failed "requires an OAuth connection".
#
# Since it has moved once, check rather than trust this. Trigger sessions are
# named `ht-exec-*`:
#
#   curl -s -H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN" \
#     https://api.digitalocean.com/v2/action-gateway/sessions?per_page=200 \
#     | jq -r '.sessions[] | "\(.createdAt)  \(.actorId)  \(.name)"' | sort
#
# How that was settled, because the earlier reasoning was plausible and
# wrong. The username connection was deleted, leaving only a freshly granted
# UUID one. A complaint was submitted. The run failed unauthorized, and a
# *new* pending connection for the username appeared, created during the
# tool call. Action Gateway only materializes a record for the actor it is
# resolving, so that is the actor. Authorizing it fixed the demo on the next
# run: ticket #58 → issue #58.
#
# There is no username field on the account API — `doctl account get` offers
# Email, Team, UUID and Status, and nothing else. The actor is the email's
# local part, which is a derivation rather than a documented mapping.
#
# There is no way to choose the actor. It is always the user who owns the
# trigger: the agent manifest rejects `actor`, `run_as`, `user`, `identity`,
# and `actor` / `user_id` / `connection` / `connection_id` under `do.actions`
# as unknown fields (tested 2026-09-29). This script can only authorize the
# connection under the name the platform already uses for you.

set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -t 1 ]; then BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else BOLD=""; GREEN=""; YELLOW=""; DIM=""; RESET=""; fi

[ -f .env ] || { echo ".env not found" >&2; exit 1; }
set -a; . ./.env; set +a

# Nothing to connect when the integration is off — say so rather than mint an
# authorization link nobody needs.
case "$(printf '%s' "${ENABLE_GITHUB_ISSUES:-false}" | tr '[:upper:]' '[:lower:]')" in
  true|1|yes|on) ;;
  *) printf "\n  GitHub issues are off (ENABLE_GITHUB_ISSUES=%s). Nothing to connect.\n" "${ENABLE_GITHUB_ISSUES:-false}"
     printf "  Set ENABLE_GITHUB_ISSUES=true and GITHUB_ISSUE_REPO in .env, run ./deploy.sh, then this.\n\n"
     exit 0 ;;
esac
[ -n "${DIGITALOCEAN_ACCESS_TOKEN:-}" ] || { echo "DIGITALOCEAN_ACCESS_TOKEN is not set in .env" >&2; exit 1; }
export DIGITALOCEAN_ACCESS_TOKEN
command -v doctl >/dev/null || { echo "doctl is required" >&2; exit 1; }
command -v jq    >/dev/null || { echo "jq is required" >&2; exit 1; }

ACTOR="$(doctl account get --output json 2>/dev/null \
  | jq -r '.email // empty' | cut -d@ -f1 | tr -d ' ')"
[ -n "$ACTOR" ] || { echo "could not determine your Action Gateway actor from doctl account get" >&2; exit 1; }

# Comma-separated. `default` omits the field and takes the platform's nine.
: "${AG_SCOPES:=repo,read:user}"
if [ "$AG_SCOPES" = "default" ]; then
  SCOPES_JSON="null"
else
  SCOPES_JSON="$(printf '%s' "$AG_SCOPES" | jq -Rc 'split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(. != ""))')"
fi

API="https://api.digitalocean.com/v2/action-gateway/connections"
AUTH=(-H "Authorization: Bearer $DIGITALOCEAN_ACCESS_TOKEN")

force=""
[ "${1:-}" = "--force" ] && force=1

conn="$(curl -sf "${AUTH[@]}" "$API" \
  | jq -c --arg a "$ACTOR" '[.connections[]? | select(.provider=="github" and .user_id==$a)][0] // {}' \
  || echo '{}')"
existing="$(printf '%s' "$conn" | jq -r '.status // empty')"
conn_id="$(printf '%s' "$conn" | jq -r '.id // empty')"

# Scopes asked for but not granted. An active connection with too few scopes
# is not "already authorized": it files issues and fails every label call.
missing_scopes=""
if [ "$SCOPES_JSON" != "null" ]; then
  missing_scopes="$(printf '%s' "$conn" | jq -r --argjson want "$SCOPES_JSON" \
    '$want - (.scopes // []) | join(", ")')"
fi

if [ "$existing" = "active" ] && [ -z "$force" ]; then
  if [ -n "$missing_scopes" ]; then
    printf "\n  %s!%s GitHub is authorized for actor %s but lacks: %s\n" "$YELLOW" "$RESET" "$ACTOR" "$missing_scopes"
    printf "  %sRe-run with --force to re-authorize with AG_SCOPES (%s).%s\n\n" "$DIM" "$AG_SCOPES" "$RESET"
    exit 1
  fi
  printf "\n  %s✓%s GitHub is already authorized for actor %s\n\n" "$GREEN" "$RESET" "$ACTOR"
  exit 0
fi

# --force means the record looks healthy and the token behind it is not, which
# is the one case where you actually need a new link and the one case the API
# refuses to mint one. DELETE returns the record to `revoked`, after which a
# POST issues a link again. There is no gentler call that achieves this.
if [ -n "$force" ] && [ -n "$conn_id" ] && [ "$conn_id" != "null" ]; then
  printf "\n  %s!%s Revoking the existing GitHub connection for actor %s\n" "$YELLOW" "$RESET" "$ACTOR"
  printf "    %sIssues will not be filed until you complete the link below.%s\n" "$DIM" "$RESET"
  if curl -sf -X DELETE "${AUTH[@]}" "$API/$conn_id" >/dev/null 2>&1; then
    printf "  %s✓%s revoked\n" "$GREEN" "$RESET"
  else
    printf "  %s!%s could not revoke %s — asking for a link anyway\n" "$YELLOW" "$RESET" "$conn_id"
  fi
fi

# `scopes` is honoured on create and defaults to nine when omitted —
# codespace, gist, notifications, project, read:user, repo, user,
# user:follow, workflow. The demo opens issues and labels them on one
# repository, so AG_SCOPES defaults to only what those tools declare, and
# `AG_SCOPES=default` sends no field to get all nine. `repo` alone is not
# enough: it files issues, but github_add_issue_labels and
# github_create_label also require `read:user`, and without it every label
# call fails "missing scopes" while the issue itself lands unlabelled. The
# per-tool requirements are in the tool catalog:
#   GET /v2/action-gateway/tools?toolkitId=github  →  .definitions[].auth
body="$(jq -nc --arg a "$ACTOR" --argjson s "$SCOPES_JSON" \
  '{provider: "github", user_id: $a} + (if $s == null then {} else {scopes: $s} end)')"
resp="$(curl -sf -X POST "${AUTH[@]}" -H "Content-Type: application/json" "$API" -d "$body")" \
  || { echo "could not request an authorization link" >&2; exit 1; }

url="$(printf '%s' "$resp"  | jq -r '.authorization.connect_url // empty')"
code="$(printf '%s' "$resp" | jq -r '.authorization.verification_code // empty')"
exp="$(printf '%s' "$resp"  | jq -r '.authorization.expires_at // empty')"

if [ -z "$url" ]; then
  # The API returns no link when it considers the connection healthy, which
  # it does even when the token behind it has expired.
  printf "\n  %s✓%s GitHub connection is active for actor %s\n" "$GREEN" "$RESET" "$ACTOR"
  printf "  %sIf tools still fail with \"requires an OAuth connection\", the token\n" "$DIM"
  printf "  behind this record has expired. Re-run with --force to revoke it and\n"
  printf "  get a fresh link.%s\n\n" "$RESET"
  exit 0
fi

printf "\n  %sAuthorize GitHub for Action Gateway%s\n\n" "$BOLD" "$RESET"
printf "    %s\n\n" "$url"
printf "    verification code  %s%s%s\n" "$BOLD" "$code" "$RESET"
printf "    actor              %s\n" "$ACTOR"
printf "    scopes             %s\n" "$AG_SCOPES"
[ -n "$exp" ] && printf "    expires            %s\n" "$exp"
printf "\n  %sLinks are one-time. Re-run this script for a fresh one.%s\n" "$DIM" "$RESET"
printf "  %sVerify afterwards with: ./scripts/connect-github.sh%s\n\n" "$DIM" "$RESET"
