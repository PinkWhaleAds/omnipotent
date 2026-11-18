#!/usr/bin/env bash
#
# Keep the local secret store (moto) and the development secrets on AWS in step.
#
# AWS Secrets Manager, under `omnipotent/dev/`, is where the development secrets **live**: it keeps
# them across machines and across restarts. moto, the store the backend reads in development, keeps
# nothing on disk — a `docker compose down`, a reboot or a new machine leaves it empty. So, for each
# secret the backend reads, this copies:
#
# - from AWS to moto, when moto lacks it or AWS holds the newer value;
# - from moto to AWS, when AWS lacks it or moto holds the newer value (a consent given locally);
# - and asks for it, without echo, only when neither side has it.
#
# It does the same for the GitHub token that installs the omnipass package, between AWS and
# `~/.npmrc`, so that a new machine needs nothing but its AWS profile.
#
# No value is ever printed, nor passed as an argument (visible in `ps`): values go through temporary
# files, readable by you alone, removed on exit. The production secrets are not touched: they live
# under `omnipotent/prod/`, in containers Terraform declares, and are written by hand.
#
# Usage, from backend/:
#   pnpm secrets:seed                 sync everything
#   pnpm secrets:seed set <name>      ask for one secret again and replace it on both sides
#                                     (<name>: omnipass/client-secret, google-ads/service-account,
#                                     google-ads/inviter, microsoft-ads/app, github/npm-token)
#
# Environment: AWS_SEED_PROFILE (default omnilor). For the tests of this script only,
# SEED_REMOTE_ENDPOINT makes another local store stand in for AWS, and SEED_NPMRC another file for
# ~/.npmrc.
set -euo pipefail

LOCAL_ENDPOINT="${SECRETS_ENDPOINT:-http://localhost:9022}"
REGION="${SECRETS_REGION:-eu-north-1}"
LOCAL_PREFIX="${SECRETS_PREFIX:-omnipotent}"
REMOTE_PREFIX="${SEED_REMOTE_PREFIX:-omnipotent/dev}"
REMOTE_ENDPOINT="${SEED_REMOTE_ENDPOINT:-}"
PROFILE="${AWS_SEED_PROFILE:-omnilor}"
NPMRC="${SEED_NPMRC:-$HOME/.npmrc}"
OMNIPASS_NAME="${OMNIPASS_SECRET_NAME:-omnipass/client-secret}"
NPM_TOKEN_NAME="github/npm-token"
COMPOSE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/compose.yaml"

fail() {
  echo "$1" >&2
  exit 1
}

case "$LOCAL_ENDPOINT" in
  http://localhost:* | http://127.0.0.1:*) ;;
  *) fail "Refused: $LOCAL_ENDPOINT is not a local secret store." ;;
esac
case "$REMOTE_PREFIX" in
  */prod | */prod/*) fail "Refused: $REMOTE_PREFIX is a production prefix; those values are written by hand." ;;
esac

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
LOCAL_VALUE="$TMP_DIR/local"
REMOTE_VALUE="$TMP_DIR/remote"
NEW_VALUE="$TMP_DIR/new"

# moto accepts any key; clearing the shell's own credentials keeps a real account out of these calls.
aws_local() {
  env -u AWS_PROFILE -u AWS_SESSION_TOKEN AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_PAGER= \
    aws --endpoint-url "$LOCAL_ENDPOINT" --region "$REGION" "$@"
}

# The real account, through the profile alone: credentials in the environment would override it.
aws_remote() {
  if [[ -n "$REMOTE_ENDPOINT" ]]; then
    env -u AWS_PROFILE -u AWS_SESSION_TOKEN AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_PAGER= \
      aws --endpoint-url "$REMOTE_ENDPOINT" --region "$REGION" "$@"
  else
    env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE AWS_PAGER= \
      aws --profile "$PROFILE" --region "$REGION" "$@"
  fi
}

# Read the current value of a secret into a file, byte for byte. Fails when it has none.
# $1 local|remote, $2 secret id, $3 file
read_secret() {
  "aws_$1" secretsmanager get-secret-value --secret-id "$2" --query SecretString --output json 2>/dev/null |
    python3 -I -c 'import json, sys; sys.stdout.write(json.load(sys.stdin))' >"$3" 2>/dev/null
}

# When a secret last changed, in epoch seconds.
# $1 local|remote, $2 secret id
changed_at() {
  "aws_$1" secretsmanager describe-secret --secret-id "$2" --query LastChangedDate --output text |
    python3 -I -c 'import datetime, sys; print(int(datetime.datetime.fromisoformat(sys.stdin.read().strip()).timestamp()))'
}

# Write the content of a file as a secret, creating it or adding a new version.
# $1 local|remote, $2 secret id, $3 file
write_secret() {
  if "aws_$1" secretsmanager describe-secret --secret-id "$2" >/dev/null 2>&1; then
    "aws_$1" secretsmanager put-secret-value --secret-id "$2" --secret-string "file://$3" >/dev/null
  else
    "aws_$1" secretsmanager create-secret --name "$2" --secret-string "file://$3" \
      --description "Omnipotent development secret, kept in step by pnpm secrets:seed" >/dev/null
  fi
}

# Write a JSON object to a file from exported variables, so that no value is ever an argument.
# $1 file, then `key=VARIABLE` pairs
json_to() {
  local file="$1"
  shift
  python3 -I -c '
import json, os, sys
pairs = (arg.split("=", 1) for arg in sys.argv[1:])
sys.stdout.write(json.dumps({key: os.environ[var] for key, var in pairs}))
' "$@" >"$file"
}

# --- Asking, when no side has a value. Each writes $NEW_VALUE, or fails when the answer is empty. --

ask_omnipass() {
  local value=""
  echo "  The client secret of omnipass's machine account (Auth0)."
  read -r -s -p "  Client secret: " value || true
  echo
  [[ -n "$value" ]] || return 1
  printf '%s' "$value" >"$NEW_VALUE"
}

ask_service_account() {
  local path="" email
  echo "  The JSON key file of the Google service account."
  read -r -p "  Path of the .json file: " path || true
  path="${path/#\~/$HOME}"
  [[ -n "$path" ]] || return 1
  if ! email="$(python3 -I -c '
import json, sys
key = json.load(open(sys.argv[1]))
assert key.get("type") == "service_account" and key.get("client_email") and key.get("private_key")
print(key["client_email"])
' "$path" 2>/dev/null)"; then
    echo "  $path is not a service account key (type, client_email and private_key are required)." >&2
    return 1
  fi
  echo "  Service account: $email"
  cp "$path" "$NEW_VALUE"
}

ask_inviter() {
  local client_id="" client_secret=""
  echo "  The Google OAuth client (Desktop app) the MCC admin consents through."
  read -r -p "  Client ID: " client_id || true
  [[ -n "$client_id" ]] || return 1
  read -r -s -p "  Client secret: " client_secret || true
  echo
  (export client_id client_secret && json_to "$NEW_VALUE" clientId=client_id clientSecret=client_secret)
}

ask_microsoft() {
  local client_id="" client_secret="" developer_token=""
  echo "  The Entra application and the Microsoft Advertising developer token."
  read -r -p "  Application (client) ID: " client_id || true
  [[ -n "$client_id" ]] || return 1
  read -r -s -p "  Client secret (the Value column): " client_secret || true
  echo
  read -r -s -p "  Developer token: " developer_token || true
  echo
  (
    export client_id client_secret developer_token &&
      json_to "$NEW_VALUE" clientId=client_id clientSecret=client_secret developerToken=developer_token
  )
}

ask_npm_token() {
  local value=""
  echo "  A GitHub token (classic) of the PinkWhaleAds account, scope read:packages (runbook A1a)."
  read -r -s -p "  Token: " value || true
  echo
  [[ -n "$value" ]] || return 1
  printf '%s' "$value" >"$NEW_VALUE"
}

# The function that asks for a secret, by name.
# $1 name
asker_of() {
  case "$1" in
    "$OMNIPASS_NAME") echo ask_omnipass ;;
    google-ads/service-account) echo ask_service_account ;;
    google-ads/inviter) echo ask_inviter ;;
    microsoft-ads/app) echo ask_microsoft ;;
    "$NPM_TOKEN_NAME") echo ask_npm_token ;;
    *) return 1 ;;
  esac
}

# --- The ~/.npmrc side of the GitHub token ----------------------------------------------------------

NPMRC_KEY="//npm.pkg.github.com/:_authToken="

# Read the token of ~/.npmrc into a file. Fails when there is none, or only a ${VARIABLE} reference.
# $1 file
read_npmrc() {
  [[ -f "$NPMRC" ]] || return 1
  python3 -I -c '
import sys
key = sys.argv[2]
for line in open(sys.argv[1]):
    line = line.strip()
    if line.startswith(key) and not line[len(key):].startswith("${"):
        sys.stdout.write(line[len(key):])
        sys.exit(0)
sys.exit(1)
' "$NPMRC" "$NPMRC_KEY" >"$1"
}

# Write the token of a file into ~/.npmrc, replacing its line or adding one, readable by you alone.
# $1 file
write_npmrc() {
  python3 -I -c '
import os, sys
path, key, token = sys.argv[1], sys.argv[2], open(sys.argv[3]).read()
lines = open(path).read().splitlines() if os.path.exists(path) else []
lines = [line for line in lines if not line.strip().startswith(key)] + [key + token]
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as out:
    out.write("\n".join(lines) + "\n")
os.chmod(path, 0o600)
' "$NPMRC" "$NPMRC_KEY" "$1"
}

# --- Syncing ----------------------------------------------------------------------------------------

# Bring one secret in step on both sides.
# $1 name, relative to both prefixes
sync_secret() {
  local name="$1" local_id="$LOCAL_PREFIX/$1" remote_id="$REMOTE_PREFIX/$1" here=0 there=0
  read_secret local "$local_id" "$LOCAL_VALUE" && here=1
  read_secret remote "$remote_id" "$REMOTE_VALUE" && there=1

  if ((here && there)); then
    if cmp -s "$LOCAL_VALUE" "$REMOTE_VALUE"; then
      echo "  =  $name: up to date"
    elif (($(changed_at local "$local_id") > $(changed_at remote "$remote_id"))); then
      write_secret remote "$remote_id" "$LOCAL_VALUE"
      echo "  ↑  $name: newer here, sent to AWS"
    else
      write_secret local "$local_id" "$REMOTE_VALUE"
      echo "  ↓  $name: newer on AWS, taken from it"
    fi
  elif ((there)); then
    write_secret local "$local_id" "$REMOTE_VALUE"
    echo "  ↓  $name: taken from AWS"
  elif ((here)); then
    write_secret remote "$remote_id" "$LOCAL_VALUE"
    echo "  ↑  $name: sent to AWS"
  else
    echo "  ?  $name: on neither side."
    if "$(asker_of "$name")"; then
      write_secret remote "$remote_id" "$NEW_VALUE"
      write_secret local "$local_id" "$NEW_VALUE"
      echo "  +  $name: saved on AWS and here"
    else
      echo "  -  $name: skipped"
    fi
  fi
}

# Bring the GitHub token in step between AWS and ~/.npmrc.
sync_npm_token() {
  local remote_id="$REMOTE_PREFIX/$NPM_TOKEN_NAME" here=0 there=0
  read_npmrc "$LOCAL_VALUE" && here=1
  read_secret remote "$remote_id" "$REMOTE_VALUE" && there=1

  if ((here && there)); then
    if cmp -s "$LOCAL_VALUE" "$REMOTE_VALUE"; then
      echo "  =  $NPM_TOKEN_NAME: up to date"
    elif (($(stat -c %Y "$NPMRC") > $(changed_at remote "$remote_id"))); then
      write_secret remote "$remote_id" "$LOCAL_VALUE"
      echo "  ↑  $NPM_TOKEN_NAME: newer in ~/.npmrc, sent to AWS"
    else
      write_npmrc "$REMOTE_VALUE"
      echo "  ↓  $NPM_TOKEN_NAME: newer on AWS, written to ~/.npmrc"
    fi
  elif ((there)); then
    write_npmrc "$REMOTE_VALUE"
    echo "  ↓  $NPM_TOKEN_NAME: taken from AWS, written to ~/.npmrc"
  elif ((here)); then
    write_secret remote "$remote_id" "$LOCAL_VALUE"
    echo "  ↑  $NPM_TOKEN_NAME: sent to AWS"
  else
    echo "  ?  $NPM_TOKEN_NAME: on neither side."
    if ask_npm_token; then
      write_secret remote "$remote_id" "$NEW_VALUE"
      write_npmrc "$NEW_VALUE"
      echo "  +  $NPM_TOKEN_NAME: saved on AWS and in ~/.npmrc"
    else
      echo "  -  $NPM_TOKEN_NAME: skipped"
    fi
  fi
}

# --- Before anything: both stores must answer ------------------------------------------------------

if [[ -z "$REMOTE_ENDPOINT" ]]; then
  if ! account="$(aws_remote sts get-caller-identity --query Account --output text 2>/dev/null)"; then
    fail "AWS does not answer with the profile \"$PROFILE\": set it up first (docs/nouveau-poste.md § 2)."
  fi
  echo "AWS: account $account, profile $PROFILE, prefix $REMOTE_PREFIX/"
else
  echo "AWS stand-in: $REMOTE_ENDPOINT, prefix $REMOTE_PREFIX/"
fi

if ! aws_local secretsmanager list-secrets --max-results 1 >/dev/null 2>&1; then
  if [[ "$LOCAL_ENDPOINT" == "http://localhost:9022" ]] && command -v docker >/dev/null; then
    echo "The local store is not running: starting it."
    docker compose -f "$COMPOSE_FILE" up -d --wait moto >/dev/null
  fi
  aws_local secretsmanager list-secrets --max-results 1 >/dev/null 2>&1 ||
    fail "The local store does not answer on $LOCAL_ENDPOINT: run \`docker compose up -d moto\` in backend/."
fi
echo "Local store: $LOCAL_ENDPOINT, prefix $LOCAL_PREFIX/"
echo

# --- One secret asked for again ---------------------------------------------------------------------

if [[ "${1:-}" == "set" ]]; then
  name="${2:-}"
  asker="$(asker_of "$name")" || fail "Unknown secret \"$name\". Known: $OMNIPASS_NAME, google-ads/service-account, google-ads/inviter, microsoft-ads/app, $NPM_TOKEN_NAME."
  "$asker" || fail "Nothing entered: nothing changed."
  write_secret remote "$REMOTE_PREFIX/$name" "$NEW_VALUE"
  if [[ "$name" == "$NPM_TOKEN_NAME" ]]; then
    write_npmrc "$NEW_VALUE"
    echo "  +  $name: replaced on AWS and in ~/.npmrc"
  else
    write_secret local "$LOCAL_PREFIX/$name" "$NEW_VALUE"
    echo "  +  $name: replaced on AWS and here"
  fi
  exit 0
fi

# --- Everything -------------------------------------------------------------------------------------

[[ -z "${1:-}" ]] || fail "Unknown command \"$1\". Usage: pnpm secrets:seed [set <name>]"

for name in "$OMNIPASS_NAME" google-ads/service-account google-ads/inviter microsoft-ads/app; do
  sync_secret "$name"
done
sync_npm_token
echo
echo "Done. Nothing was printed but names."
