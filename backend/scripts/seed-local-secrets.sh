#!/usr/bin/env bash
#
# Seed the local secret store (moto, `docker compose up -d moto`) with the credentials the backend
# reads from it.
#
# moto keeps nothing on disk: a `docker compose down` erases every secret, and a new machine starts
# empty. This asks for each value without echoing it, hands it to the AWS CLI through a temporary file
# (an argument would show in `ps`), and never prints it back. An empty answer skips that secret, and a
# secret already there is only replaced when you say so.
#
# It refuses any endpoint that is not on this machine: the production values are written by hand, in
# the containers Terraform declares, never by a script (`infra/README.md`).
#
# Usage, from backend/:  pnpm secrets:seed
set -euo pipefail

ENDPOINT="${SECRETS_ENDPOINT:-http://localhost:9022}"
REGION="${SECRETS_REGION:-eu-north-1}"
PREFIX="${SECRETS_PREFIX:-omnipotent}"
OMNIPASS_NAME="${OMNIPASS_SECRET_NAME:-omnipass/client-secret}"

case "$ENDPOINT" in
  http://localhost:* | http://127.0.0.1:*) ;;
  *)
    echo "Refused: $ENDPOINT is not a local secret store. This script only seeds moto." >&2
    exit 1
    ;;
esac

# moto accepts any key; these also keep a real AWS profile of the shell out of the calls.
export AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_PAGER=""
unset AWS_PROFILE AWS_SESSION_TOKEN

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

aws_local() { aws --endpoint-url "$ENDPOINT" --region "$REGION" "$@"; }

if ! aws_local secretsmanager list-secrets --max-results 1 >/dev/null 2>&1; then
  echo "The secret store does not answer on $ENDPOINT: run \`docker compose up -d moto\` first." >&2
  exit 1
fi

# Whether a secret must be written: always when absent, on a yes when present.
# $1 name relative to the prefix, $2 what to call it, $3 a warning shown before replacing
should_write() {
  local answer
  aws_local secretsmanager describe-secret --secret-id "$PREFIX/$1" >/dev/null 2>&1 || return 0
  read -r -p "  Already set${3:+ ($3)}. Replace it? [y/N] " answer
  [[ "$answer" == [yYoO] ]]
}

# Write the content of a file as a secret, creating it or adding a new version.
# $1 name relative to the prefix, $2 the file
put_secret() {
  local id="$PREFIX/$1"
  if aws_local secretsmanager describe-secret --secret-id "$id" >/dev/null 2>&1; then
    aws_local secretsmanager put-secret-value --secret-id "$id" --secret-string "file://$2" >/dev/null
    echo "  -> $id replaced"
  else
    aws_local secretsmanager create-secret --name "$id" --secret-string "file://$2" >/dev/null
    echo "  -> $id created"
  fi
}

# Write a JSON object to $TMP from environment variables, so that no value is ever an argument.
# Arguments are `key=VARIABLE` pairs; the variables must be exported by the caller's subshell.
json_to_tmp() {
  python3 -I -c '
import json, os, sys
pairs = (arg.split("=", 1) for arg in sys.argv[1:])
sys.stdout.write(json.dumps({key: os.environ[var] for key, var in pairs}))
' "$@" >"$TMP"
}

echo "Seeding $ENDPOINT, prefix $PREFIX. An empty answer skips a secret."

echo
echo "1. omnipass: the client secret of the machine account (Auth0). The API does not start without it."
if should_write "$OMNIPASS_NAME" "omnipass"; then
  read -r -s -p "  Client secret: " value && echo
  if [[ -n "$value" ]]; then
    printf '%s' "$value" >"$TMP"
    put_secret "$OMNIPASS_NAME" "$TMP"
  fi
  unset value
fi

echo
echo "2. Google Ads: the JSON key file of the service account."
if should_write "google-ads/service-account" "service account"; then
  read -r -p "  Path of the .json file: " path
  path="${path/#\~/$HOME}"
  if [[ -n "$path" ]]; then
    if email="$(python3 -I -c '
import json, sys
key = json.load(open(sys.argv[1]))
assert key.get("type") == "service_account" and key.get("client_email") and key.get("private_key")
print(key["client_email"])
' "$path" 2>/dev/null)"; then
      echo "  Service account: $email"
      put_secret "google-ads/service-account" "$path"
    else
      echo "  Skipped: $path is not a service account key (type, client_email and private_key are required)." >&2
    fi
  fi
fi

echo
echo "3. Google Ads: the OAuth client (Desktop app) the MCC admin will consent through."
if should_write "google-ads/inviter" "inviter" "replacing it erases a consent already given"; then
  read -r -p "  Client ID: " client_id
  if [[ -n "$client_id" ]]; then
    read -r -s -p "  Client secret: " client_secret && echo
    (export client_id client_secret && json_to_tmp clientId=client_id clientSecret=client_secret)
    put_secret "google-ads/inviter" "$TMP"
  fi
  unset client_id client_secret
fi

echo
echo "4. Microsoft Advertising: the Entra application and the developer token."
if should_write "microsoft-ads/app" "Microsoft app"; then
  read -r -p "  Application (client) ID: " client_id
  if [[ -n "$client_id" ]]; then
    read -r -s -p "  Client secret (the Value column): " client_secret && echo
    read -r -s -p "  Developer token: " developer_token && echo
    (
      export client_id client_secret developer_token &&
        json_to_tmp clientId=client_id clientSecret=client_secret developerToken=developer_token
    )
    put_secret "microsoft-ads/app" "$TMP"
  fi
  unset client_id client_secret developer_token
fi

echo
echo "In the store now (names only):"
aws_local secretsmanager list-secrets --query 'SecretList[].Name' --output text | tr '\t' '\n' | sort | sed 's/^/  /'
