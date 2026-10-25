#!/usr/bin/env bash
#
# Deploys omnipotent to an environment from this machine, with the local AWS CLI profile (AWS_PROFILE): what
# .github/workflows/deploy.yml does on GitHub, for an environment GitHub cannot deploy (the test account allows no GitHub
# OIDC provider). The same steps, the same SSM parameters (/omnipotent/<environment>/deploy/*), the same checks:
#
#   1. the backend image of the commit, built for linux/arm64 (Fargate Graviton) and pushed to the environment's ECR
#      repository, tagged with the commit SHA (skipped when that tag exists: tags are immutable);
#   2. the database migrations, as a one-off ECS task: if they fail, the deploy stops there and nothing else changes;
#   3. new API and worker revisions (each family's latest revision with the image swapped), the services moved to them
#      and waited for until stable;
#   4. a smoke test: /readyz and /status of the API.
#
# Usage:
#   AWS_PROFILE=omnipotent infra/scripts/deploy.sh test [--ref <commit>] [--plan] [--yes]
#
# Needs the AWS CLI v2 (2.32 or later for `aws login`), Docker with buildx (Docker Desktop), git, jq and curl. The commit
# is exported from git: uncommitted changes are never deployed. Compatible with macOS's bash 3.2.
set -euo pipefail

readonly PROJECT="omnipotent"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly REPO_ROOT

# The AWS CLI must never open a pager.
export AWS_PAGER=""

if [ -t 1 ]; then
  BOLD=$'\033[1m' RED=$'\033[31m' YELLOW=$'\033[33m' GREEN=$'\033[32m' RESET=$'\033[0m'
else
  BOLD="" RED="" YELLOW="" GREEN="" RESET=""
fi

step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%sWARNING:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die() {
  printf '%sERROR:%s %s\n' "$RED" "$RESET" "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: infra/scripts/deploy.sh <environment> [options]

Deploys the commit to <environment> (test, prod...) with the AWS profile of AWS_PROFILE:
backend image (linux/arm64) -> migrations -> API and worker -> smoke test.

Options:
  --ref <commit>   commit to deploy (default: HEAD). An older commit rolls back (migrations are never reverted).
  --plan           check everything and print what would be done, change nothing (no build, no AWS write).
  --yes            do not ask for confirmation.
  --region <name>  region of the environment (default: AWS_REGION, else eu-north-1).
  -h, --help       this help.

Example:
  aws login --profile omnipotent
  AWS_PROFILE=omnipotent infra/scripts/deploy.sh test --plan
  AWS_PROFILE=omnipotent infra/scripts/deploy.sh test
EOF
}

# ---------------------------------------------------------------------------------------------------
# Arguments
# ---------------------------------------------------------------------------------------------------

ENVIRONMENT=""
REF="HEAD"
PLAN=false
YES=false
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-eu-north-1}}"

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)
      [ $# -ge 2 ] || die "--ref needs a commit"
      REF="$2"
      shift 2
      ;;
    --ref=*)
      REF="${1#--ref=}"
      shift
      ;;
    --plan | --dry-run)
      PLAN=true
      shift
      ;;
    --yes | -y)
      YES=true
      shift
      ;;
    --region)
      [ $# -ge 2 ] || die "--region needs a region"
      AWS_REGION="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "Unknown option $1 (see --help)" ;;
    *)
      [ -z "$ENVIRONMENT" ] || die "One environment only (got $ENVIRONMENT and $1)"
      ENVIRONMENT="$1"
      shift
      ;;
  esac
done

if [ -z "$ENVIRONMENT" ]; then
  usage >&2
  exit 2
fi
case "$ENVIRONMENT" in
  *[!a-z0-9]*) die "The environment is a lower-case name such as test or prod, not '$ENVIRONMENT'" ;;
esac
export AWS_REGION

# ---------------------------------------------------------------------------------------------------
# Working directory and cleanup
# ---------------------------------------------------------------------------------------------------

TMP_ROOT="${TMPDIR:-/tmp}"
WORK_DIR="$(mktemp -d "${TMP_ROOT%/}/omnipotent-deploy.XXXXXX")"
ECR_REGISTRY_LOGGED_IN=""
DEPLOY_STARTED=false

cleanup() {
  local status=$?
  if [ -n "$ECR_REGISTRY_LOGGED_IN" ]; then
    docker logout "$ECR_REGISTRY_LOGGED_IN" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_DIR"
  if [ "$status" -ne 0 ] && $DEPLOY_STARTED; then
    printf '\n%sThe deploy of %s to %s FAILED%s (exit %s, after %ss): see the messages above.\n' \
      "$RED" "${SHA:-?}" "$ENVIRONMENT" "$RESET" "$status" "$SECONDS" >&2
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------------------------------
# Checks: tools, AWS session, commit, deploy parameters
# ---------------------------------------------------------------------------------------------------

step "Tools"
for command in aws git jq curl tar; do
  command -v "$command" >/dev/null 2>&1 || die "$command is not installed"
done
if ! $PLAN; then
  command -v docker >/dev/null 2>&1 || die "docker is not installed (Docker Desktop)"
  docker info >/dev/null 2>&1 || die "Docker is not running: start Docker Desktop"
  docker buildx version >/dev/null 2>&1 || die "docker buildx is missing (Docker Desktop includes it)"
fi
info "$(aws --version 2>&1)"

step "AWS session"
[ -n "${AWS_PROFILE:-}" ] || warn "AWS_PROFILE is not set: the default credentials of this machine are used"
if ! identity="$(aws sts get-caller-identity --output json 2>&1)"; then
  die "No valid AWS session for the profile '${AWS_PROFILE:-default}': run  aws login --profile ${AWS_PROFILE:-<profile>}  then try again. ($identity)"
fi
ACCOUNT="$(jq -r .Account <<<"$identity")"
CALLER="$(jq -r .Arn <<<"$identity")"
info "Account $ACCOUNT as $CALLER (profile ${AWS_PROFILE:-default}, region $AWS_REGION)"

step "Commit"
SHA="$(git -C "$REPO_ROOT" rev-parse --verify --quiet "${REF}^{commit}")" || die "'$REF' is not a commit of this repository"
SUBJECT="$(git -C "$REPO_ROOT" log -1 --format=%s "$SHA")"
info "$SHA  $SUBJECT"
if [ "$ENVIRONMENT" = "prod" ]; then
  git -C "$REPO_ROOT" merge-base --is-ancestor "$SHA" origin/main 2>/dev/null ||
    die "$SHA is not on origin/main (git fetch first?): production only runs commits of main"
fi
if [ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=no)" ]; then
  warn "The working tree has uncommitted changes: they are NOT deployed, only commit ${SHA:0:12} is."
fi

# The parameters Terraform writes under /omnipotent/<environment>/deploy, as shell variables with the workflow's
# names (api-task-family -> API_TASK_FAMILY). Only these names are read; any other parameter is ignored.
step "Deploy parameters"
PARAMETERS_PATH="/$PROJECT/$ENVIRONMENT/deploy"
REQUIRED_PARAMETERS=(
  ECR_REPOSITORY_NAME ECR_REPOSITORY_URL CLUSTER API_SERVICE WORKER_SERVICE API_TASK_FAMILY WORKER_TASK_FAMILY
  MIGRATE_TASK_FAMILY CONTAINER_NAME MIGRATE_LOG_GROUP MIGRATE_SUBNETS MIGRATE_SECURITY_GROUP
  API_URL MCP_URL AUTH0_DOMAIN AUTH0_SPA_CLIENT_ID AUTH0_AUDIENCE
)
# Optional: written by Terraform since the test environment (the private subnets behind a NAT gateway before).
OPTIONAL_PARAMETERS=(MIGRATE_ASSIGN_PUBLIC_IP)
ECR_REPOSITORY_NAME="" ECR_REPOSITORY_URL="" CLUSTER="" API_SERVICE="" WORKER_SERVICE=""
API_TASK_FAMILY="" WORKER_TASK_FAMILY="" MIGRATE_TASK_FAMILY="" CONTAINER_NAME="" MIGRATE_LOG_GROUP=""
MIGRATE_SUBNETS="" MIGRATE_SECURITY_GROUP="" MIGRATE_ASSIGN_PUBLIC_IP=""
API_URL="" MCP_URL="" AUTH0_DOMAIN="" AUTH0_SPA_CLIENT_ID="" AUTH0_AUDIENCE=""
if ! parameters="$(aws ssm get-parameters-by-path --path "$PARAMETERS_PATH" --output json 2>&1)"; then
  die "Cannot read $PARAMETERS_PATH: $parameters"
fi
[ "$(jq '.Parameters | length' <<<"$parameters")" -gt 0 ] ||
  die "No parameter under $PARAMETERS_PATH in account $ACCOUNT: wrong AWS_PROFILE or region, or infra/envs/$ENVIRONMENT not applied yet"
is_known_parameter() {
  local known
  for known in "${REQUIRED_PARAMETERS[@]}" "${OPTIONAL_PARAMETERS[@]}"; do
    [ "$known" = "$1" ] && return 0
  done
  return 1
}
while IFS=$'\t' read -r name value; do
  if is_known_parameter "$name"; then
    printf -v "$name" '%s' "$value"
  fi
done < <(jq -r '.Parameters[] | [(.Name | split("/") | last | ascii_upcase | gsub("-"; "_")), .Value] | @tsv' <<<"$parameters")

for name in "${REQUIRED_PARAMETERS[@]}"; do
  [ -n "${!name}" ] || die "Parameter $name is missing under $PARAMETERS_PATH (terraform apply of infra/envs/$ENVIRONMENT done?)"
done
MIGRATE_ASSIGN_PUBLIC_IP="${MIGRATE_ASSIGN_PUBLIC_IP:-DISABLED}"
case "$MIGRATE_ASSIGN_PUBLIC_IP" in
  ENABLED | DISABLED) ;;
  *) die "Parameter MIGRATE_ASSIGN_PUBLIC_IP is '$MIGRATE_ASSIGN_PUBLIC_IP', not ENABLED or DISABLED" ;;
esac
[ "${ECR_REPOSITORY_URL%%.*}" = "$ACCOUNT" ] ||
  die "The image repository $ECR_REPOSITORY_URL is not in account $ACCOUNT"
IMAGE="$ECR_REPOSITORY_URL:$SHA"
info "$(jq '.Parameters | length' <<<"$parameters") parameters under $PARAMETERS_PATH"

# Tags are immutable: a commit already built (a second deploy, a rollback) reuses its image.
if output="$(aws ecr describe-images --repository-name "$ECR_REPOSITORY_NAME" --image-ids imageTag="$SHA" --output json 2>&1)"; then
  IMAGE_EXISTS=true
  IMAGE_PLAN="exists already: not rebuilt"
elif grep -q ImageNotFoundException <<<"$output"; then
  IMAGE_EXISTS=false
  IMAGE_PLAN="to build for linux/arm64 and push"
else
  die "Cannot read the repository $ECR_REPOSITORY_NAME: $output"
fi

step "Plan"
cat <<EOF
    Environment  $ENVIRONMENT (account $ACCOUNT, region $AWS_REGION)
    Commit       $SHA  $SUBJECT
    Image        $IMAGE
                 $IMAGE_PLAN
    Migrations   one-off task of $MIGRATE_TASK_FAMILY on cluster $CLUSTER (public IP: $MIGRATE_ASSIGN_PUBLIC_IP)
    Services     $API_SERVICE and $WORKER_SERVICE on new revisions of $API_TASK_FAMILY and $WORKER_TASK_FAMILY
    URLs         API $API_URL
                 MCP $MCP_URL
EOF

if $PLAN; then
  step "Plan only (--plan): nothing was built or changed"
  exit 0
fi

if ! $YES; then
  [ -t 0 ] || die "No terminal to confirm in: pass --yes to deploy without confirmation"
  printf '\nType the environment name (%s) to deploy commit %s to account %s: ' "$ENVIRONMENT" "${SHA:0:12}" "$ACCOUNT"
  read -r answer
  [ "$answer" = "$ENVIRONMENT" ] || die "Not confirmed: nothing was changed"
fi
DEPLOY_STARTED=true

# The committed files of the commit only (never the working tree), for the image.
SOURCE_DIR="$WORK_DIR/source"
mkdir -p "$SOURCE_DIR"
git -C "$REPO_ROOT" archive --format=tar "$SHA" backend | tar -x -C "$SOURCE_DIR"

# ---------------------------------------------------------------------------------------------------
# 1. Backend image
# ---------------------------------------------------------------------------------------------------

if $IMAGE_EXISTS; then
  step "Backend image: $IMAGE exists already, not rebuilt"
else
  step "Backend image: building $IMAGE (linux/arm64) and pushing it"
  ECR_REGISTRY="${ECR_REPOSITORY_URL%%/*}"
  aws ecr get-login-password | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null
  ECR_REGISTRY_LOGGED_IN="$ECR_REGISTRY"
  docker buildx build \
    --platform linux/arm64 \
    --provenance=false \
    --build-arg "COMMIT_SHA=$SHA" \
    --tag "$IMAGE" \
    --push \
    "$SOURCE_DIR/backend"
fi

# Terraform owns the task definitions (environment, secrets, roles, sizes): a deploy registers a copy of each family's
# latest revision with only the image changed, and prints the ARN of the new revision.
register_revision() {
  local family="$1"
  local file="$WORK_DIR/$family.json"
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json |
    jq --arg image "$IMAGE" --arg container "$CONTAINER_NAME" '
      .containerDefinitions |= map(if .name == $container then .image = $image else . end)
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
            .registeredAt, .registeredBy, .deregisteredAt)' >"$file"
  aws ecs register-task-definition --cli-input-json "file://$file" \
    --query taskDefinition.taskDefinitionArn --output text
}

# ---------------------------------------------------------------------------------------------------
# 2. Migrations
# ---------------------------------------------------------------------------------------------------

step "Database migrations"
MIGRATE_TASK_DEFINITION="$(register_revision "$MIGRATE_TASK_FAMILY")"
info "Revision $MIGRATE_TASK_DEFINITION"
run_output="$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$MIGRATE_TASK_DEFINITION" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$MIGRATE_SUBNETS],securityGroups=[$MIGRATE_SECURITY_GROUP],assignPublicIp=$MIGRATE_ASSIGN_PUBLIC_IP}" \
  --started-by "deploy-sh-${SHA:0:12}" \
  --output json)"
task_arn="$(jq -r '.tasks[0].taskArn // empty' <<<"$run_output")"
if [ -z "$task_arn" ]; then
  jq '.failures' <<<"$run_output" >&2
  die "The migration task did not start: services not updated"
fi
info "Task ${task_arn##*/}: waiting for it to stop (up to 30 minutes)"

# The waiter gives up after 10 minutes: allow up to 30.
for attempt in 1 2 3; do
  if aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task_arn"; then break; fi
  info "Still running after attempt $attempt"
done

task="$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" --output json)"
task_status="$(jq -r '.tasks[0].lastStatus' <<<"$task")"
exit_code="$(jq -r --arg c "$CONTAINER_NAME" '.tasks[0].containers[] | select(.name == $c) | .exitCode // "none"' <<<"$task")"
stopped_reason="$(jq -r '.tasks[0].stoppedReason // ""' <<<"$task")"

info "--- migration logs ($MIGRATE_LOG_GROUP) ---"
aws logs get-log-events --log-group-name "$MIGRATE_LOG_GROUP" \
  --log-stream-name "migrate/$CONTAINER_NAME/${task_arn##*/}" --start-from-head --output json 2>/dev/null |
  jq -r '.events[].message' | sed 's/^/    /' || info "(no logs: the container did not start?)"
info "--- end of the migration logs ---"

[ "$task_status" = "STOPPED" ] ||
  die "The migration task is still $task_status after 30 minutes: services not updated"
[ "$exit_code" = "0" ] ||
  die "The migrations failed (exit code $exit_code${stopped_reason:+, $stopped_reason}): services not updated"
info "${GREEN}Migrations applied${RESET}"

# ---------------------------------------------------------------------------------------------------
# 3. API and worker
# ---------------------------------------------------------------------------------------------------

step "API and worker"
API_TASK_DEFINITION="$(register_revision "$API_TASK_FAMILY")"
WORKER_TASK_DEFINITION="$(register_revision "$WORKER_TASK_FAMILY")"
aws ecs update-service --cluster "$CLUSTER" --service "$API_SERVICE" \
  --task-definition "$API_TASK_DEFINITION" --query service.serviceName --output text >/dev/null
aws ecs update-service --cluster "$CLUSTER" --service "$WORKER_SERVICE" \
  --task-definition "$WORKER_TASK_DEFINITION" --query service.serviceName --output text >/dev/null
info "$API_SERVICE -> $API_TASK_DEFINITION"
info "$WORKER_SERVICE -> $WORKER_TASK_DEFINITION"
info "Waiting for both services to be stable (up to 30 minutes; a few minutes usually)"

for attempt in 1 2 3; do
  if aws ecs wait services-stable --cluster "$CLUSTER" --services "$API_SERVICE" "$WORKER_SERVICE"; then break; fi
  info "Not stable after attempt $attempt"
done

# A deployment rolled back by the circuit breaker also ends stable, on the previous revision. The waiter can also
# return while the new deployment is still IN_PROGRESS (its task running, the load balancer still registering it):
# that state is waited for (up to 10 minutes), only FAILED, another revision or the timeout fail the deploy.
check_service() {
  local service="$1" expected="$2" current="" state="" attempt=0
  while :; do
    read -r current state < <(aws ecs describe-services --cluster "$CLUSTER" --services "$service" \
      --query "services[0].deployments[?status=='PRIMARY'] | [0].[taskDefinition, rolloutState]" --output text)
    if [ "$current" != "$expected" ] || [ "$state" != "IN_PROGRESS" ] || [ "$attempt" -ge 40 ]; then break; fi
    attempt=$((attempt + 1))
    sleep 15
  done
  if [ "$current" != "$expected" ] || [ "$state" != "COMPLETED" ]; then
    die "$service runs ${current:-?} (${state:-?}), not $expected: its tasks did not turn healthy. Its events:  aws ecs describe-services --cluster $CLUSTER --services $service --query 'services[0].events[:10].[createdAt,message]' --output text"
  fi
  info "$service runs $expected"
}
check_service "$API_SERVICE" "$API_TASK_DEFINITION"
check_service "$WORKER_SERVICE" "$WORKER_TASK_DEFINITION"

# ---------------------------------------------------------------------------------------------------
# 4. Smoke test
# ---------------------------------------------------------------------------------------------------

step "Smoke test"
smoke_failed=false
if readyz="$(curl -fsS --max-time 20 "$API_URL/readyz" 2>&1)"; then
  info "$API_URL/readyz  $readyz"
else
  warn "$API_URL/readyz did not answer 200: $readyz"
  smoke_failed=true
fi
if status_body="$(curl -fsS --max-time 20 "$API_URL/status" 2>&1)"; then
  info "$API_URL/status  $status_body"
  grep -q "$SHA" <<<"$status_body" || warn "/status does not name commit $SHA"
else
  warn "$API_URL/status did not answer 200: $status_body"
  smoke_failed=true
fi
if $smoke_failed; then
  die "Deployed $SHA to $ENVIRONMENT, but the smoke test failed: see the warnings above (logs: aws logs tail /ecs/$CLUSTER/api --since 15m)"
fi
step "${GREEN}Deployed ${SHA:0:12} to $ENVIRONMENT in ${SECONDS}s${RESET}"
info "API  $API_URL"
info "MCP  $MCP_URL"
