# Omnipotent — infrastructure

The AWS production infrastructure of Omnipotent, in Terraform, and how to deploy it. The decisions are
in [`../CADRAGE.md`](../CADRAGE.md) §19 and D42: ECS Fargate on Graviton (ARM64), region `eu-north-1`
(Stockholm), **its own RDS instance**, a Terraform separate from multi-search's, in the same AWS account.
HTTPS on the default CloudFront domain until the custom domain is set up (`omnilor.com`, DNS at
Cloudflare: [Custom domain](#custom-domain-cloudflare)). A smaller **test environment** of the same
configuration runs in a test account, deployed from a Mac:
[Test environment](#test-environment-simplified-aws-account).

Omnipotent serves **no front end of its own** (CADRAGE §21): after the switch, multi-search's front
consumes it (§18) and is deployed from its own repository. The modules here are multi-search's, minus
its `frontend` one.

```
                                    https://omnipotent.omnilor.com (API, MCP)
                                 without the domain: yyyy.cloudfront.net
                                                    │
                                 AWS WAF (rate limits per IP, AWS managed rules)
                                                    │
                                 CloudFront VPC origin (secret origin header)
                                                    │ HTTP :80 inside AWS's private network
                                 ALB (internal, private subnets) ── 403 without the header
                                                    │
   ┌──────────────────────────── VPC 10.0.0.0/16, 2 zones ───────────────────┼──────────────────────────┐
   │  private subnets:   ECS Fargate ARM64   api (1–4 tasks)   worker (1)   migrate (one-off task)        │
   │                     RDS PostgreSQL 17 (TLS required)                                                  │
   │  egress: one NAT gateway (fixed IP) ── Auth0, omnipass, the platforms;  S3 gateway endpoint          │
   └───────────────────────────────────────────────────────────────────────────────────────────────────┘
   Secrets Manager (omnipotent/prod/*) · S3 (the backend's files) · ECR · CloudWatch (logs, alarms → SNS e-mail)
   S3 access logs (CloudFront, ALB, VPC flow logs) · GuardDuty (findings → EventBridge → the same SNS e-mail)
```

A second CloudFront distribution lives in `modules/api-edge`, dormant: it serves one host answering a
single path prefix and 404 for everything else, ready for the phase that serves public files to a
client's site or to a platform. Nothing is created while its alias is unset.

## Layout

| Path                              | Holds                                                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/`                      | The S3 bucket of the Terraform states. Applied once per account, with a local state.                                                   |
| `envs/prod/`                      | The production root module: wires the modules, `terraform.tfvars.example`, the S3 backend (native lock file).                          |
| `envs/test/`                      | The test environment: links to prod's configuration, its own backend, `test_override.tf` (every difference), its offline tests.        |
| `scripts/deploy.sh`               | Deploy from a machine with a local AWS profile (the test environment): what the deploy workflow does.                                  |
| `modules/network`                 | VPC, public and private subnets on 2 zones, NAT gateway(s) (optional), S3 gateway endpoint, flow logs (to the access logs bucket).     |
| `modules/ecr`                     | Repository `omnipotent-backend`: immutable tags, scan on push, last 30 images kept.                                                  |
| `modules/database`                | RDS PostgreSQL 17, `rds.force_ssl`, IAM authentication, master password managed and rotated by RDS.                                    |
| `modules/storage`                 | Private bucket of the files the backend keeps (versioned, encrypted).                                                                 |
| `modules/secrets`                 | Empty Secrets Manager containers, declared by the caller: none in the socle. Values never go through Terraform.                       |
| `modules/ecs-cluster`             | Cluster (Container Insights) and the security group shared by every task.                                                              |
| `modules/task-roles`              | Execution role (image, logs, injected secrets); task role (its bucket, its secrets, DB sign-in); migration role.                      |
| `modules/ecs-service`             | A task definition (ARM64, logs, health check) and, optionally, its service with load balancer and CPU autoscaling.                     |
| `modules/alb`                     | Internal ALB in the private subnets: HTTP from CloudFront only, 403 without the secret header, target group on `/readyz`.              |
| `modules/api-edge`                | CloudFront in front of the ALB (VPC origin): API never cached, `cached_path_patterns` by `Cache-Control`; client IP; a dormant host.  |
| `modules/waf`                     | AWS WAF web ACL (us-east-1) of the distributions: per-IP rate limits, AWS managed rules.                                               |
| `modules/access-logs`             | Bucket of the access logs of the distributions and of the ALB, and of the VPC flow logs (90 days).                                     |
| `modules/monitoring`              | SNS topic (+ e-mail), alarms (5xx rates, unhealthy targets, running tasks, database), optional monthly budget.                         |
| `modules/github-oidc`             | GitHub OIDC provider and the deploy role (least privilege).                                                                            |
| `modules/deploy-parameters`       | SSM parameters `/omnipotent/<env>/deploy/*` read by the deploy workflow and `scripts/deploy.sh`.                                     |
| `modules/db-rotation-restart`     | Without IAM authentication: redeploys the services after each rotation of the master password.                                         |
| `modules/audit-trail`             | CloudTrail trail of the account (audit; also delivers the rotation events).                                                            |
| `modules/guardduty`               | GuardDuty detector of the region (S3 and RDS Protection, optional Runtime Monitoring), findings e-mailed through the alarm topic.      |
| `../.github/workflows/deploy.yml` | Manual deploy: image → migrations → services.                                                                                         |
| `../.github/workflows/infra.yml`  | CI of this folder: `terraform fmt`, `validate`, offline `terraform test` (prod, test), `tflint`, `shellcheck`.                         |

## Prerequisites

Terraform ≥ 1.10 (`brew install hashicorp/tap/terraform`, or Docker: `hashicorp/terraform:1.16`), the AWS CLI v2, the
GitHub CLI (`gh`), `jq` and curl. The test environment needs Docker
Desktop and the AWS CLI 2.32 or later instead of `gh` ([Test environment](#test-environment-simplified-aws-account)).

## Test environment (simplified AWS account)

The first real deployment runs in a **test account**: `903305161052`, region `eu-north-1`, opened with AWS's new
simplified experience ("projects", sign-in with AWS Builder ID, an AWS-managed organization `o-r68em6cbxk`), and
deployed from a Mac. Production will live in another account and keeps everything the rest of this file describes.

`infra/envs/test` **is** the production configuration: its `main.tf`, `variables.tf`, `outputs.tf` and `providers.tf`
are links to `../prod`, so the two cannot drift apart, and a change to the stack is made once, in `envs/prod`. Its own
files: `versions.tf` (its state, `test/terraform.tfstate` in the test account's state bucket) and `test_override.tf`,
which holds every difference as new defaults of production's variables (a Terraform
[override file](https://developer.hashicorp.com/terraform/language/files/override)); `terraform.tfvars` still wins over
them. The new switches (`task_egress`, `waf_enabled`, `edge_access_logs_enabled`, `github_deploy_role_enabled`,
`force_destroy`, `db_backup_retention_days`, `allowed_account_ids`) keep production's behaviour by default.

### What differs from production, and why

The account belongs to an organization whose policies AWS manages and nobody can change:
[service and resource control policies](https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html),
[supported services](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.html),
[regions](https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html).

| Item                        | Production                                      | Test (`test_override.tf`)                                     | Why                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GuardDuty                   | on                                              | off                                                           | Not supported: `guardduty:*` is outside what the service control policy (SCP) allows.                                                                                                                                                                                              |
| GitHub OIDC and deploy role | on                                              | off (`github_deploy_role_enabled`)                            | The SCP denies `iam:*Provider*`. The test environment is deployed from the Mac with `infra/scripts/deploy.sh`.                                                                                                                                                                     |
| CloudTrail trail            | on                                              | off (`create_audit_trail`)                                    | A multi-region trail is account-wide, and multi-region features are not supported. Not needed with `db_iam_auth`; CloudTrail's event history (90 days) stays readable.                                                                                                             |
| AWS WAF                     | on                                              | off (`waf_enabled`)                                           | "If you use CloudFront, certain features that would create resources outside of your selected Region aren't available. This includes using AWS WAF with CloudFront", and the SCP denies `wafv2:AssociateWebACL` in us-east-1. The API's own rate limits (per user, per IP) remain. |
| CloudFront and ALB logs     | on                                              | off (`edge_access_logs_enabled`)                              | CloudFront's standard logs are written by an AWS account outside the organization, which its resource control policy refuses on S3; the ALB tests the bucket when it is created. The VPC flow logs (an AWS service principal, allowed) stay on.                                    |
| Way out to the internet     | NAT gateway, fixed egress IP                    | tasks in the public subnets, a public IP each (`task_egress`) | About 30 USD a month less. Their security group still only accepts the load balancer. No fixed egress IP: a platform allow list cannot be tested (`task_egress = "nat"` for that). The internal ALB, CloudFront's VPC origin and the database stay in the private subnets.    |
| Custom domain               | omnilor.com, two stages                         | none: `*.cloudfront.net`                                      | The hostname is production's.                                                                                                                                                                                                                                                    |
| Database                    | db.t4g.small, backups 7 days                    | db.t4g.small (2 GB), backups 1 day, changes applied at once   | A db.t4g.micro (1 GB) swapped 270 MB idle. Single-AZ in both.                                                                                                                                                                                                                      |
| Tasks                       | API 0.5 vCPU / 1 GB (1 to 4), worker 0.5 / 1 GB | API 0.25 vCPU / 0.5 GB (1 to 2), worker 0.25 / 1 GB           | Cost. If a task runs short of memory (exit code 137 in the service's events), set `api_cpu = 512` and `api_memory = 1024` in `terraform.tfvars`.                                                                                                                                   |
| Container Insights          | on                                              | off                                                           | About 8 USD a month; the "no running task" alarms go with it (the ECS console still shows the tasks).                                                                                                                                                                              |
| Retention                   | logs 30 days, access logs 90                    | 7 and 14                                                      | Cost.                                                                                                                                                                                                                                                                              |
| `terraform destroy`         | refused by the database, keeps the data         | deletes everything, data included (`force_destroy`)           | A disposable environment: no deletion protection or final snapshot, buckets emptied, images and secrets deleted at once. `force_destroy` is refused for prod.                                                                                                                      |
| Swagger UI                  | off                                             | on (`docs_enabled`)                                           | Useful while testing (its Auth0 callback below).                                                                                                                                                                                                                                   |
| Names                       | `omnipotent-prod-…`, `omnipotent-backend`   | `omnipotent-test-…`, `omnipotent-test-backend`            | Other projects share the account: secrets under `omnipotent/test/`, parameters under `/omnipotent/test/deploy/`, logs under `/ecs/omnipotent-test/`.                                                                                                                         |
| Account guard               | none yet                                        | `allowed_account_ids = ["903305161052"]`                      | The provider refuses any other account (a wrong `AWS_PROFILE`). Set production's once its account exists.                                                                                                                                                                          |

Nothing of the test stack is account-wide: no GuardDuty detector, OIDC provider, trail or account budget, no
account-level S3 public access block, default EBS encryption or IAM password policy, and no service-linked role
created by Terraform (AWS creates the ones it needs, CloudFront's VPC origins and Application Auto Scaling for ECS,
only when they are missing; those of ECS, RDS and Elastic Load Balancing already exist and are reused). The default VPC
is not touched. The offline tests (`envs/test/tests`) check this.

### Monthly cost

An estimate in `eu-north-1`, at low traffic, from the prices of the [Costs](#costs) table (October 2026), before taxes:

| Item                                               | Test                                         | USD / month | Production (Costs) |
| -------------------------------------------------- | -------------------------------------------- | ----------: | -----------------: |
| Fargate ARM64                                      | API 0.25 vCPU / 0.5 GB + worker 0.25 / 1 GB  |          17 |                 32 |
| NAT gateway                                        | none                                         |           0 |                 35 |
| Public IPv4                                        | one per task (production: the NAT gateway's) |           7 |                  4 |
| Application Load Balancer                          | idle (no LCU to speak of)                    |          18 |                 23 |
| RDS PostgreSQL                                     | db.t4g.small Single-AZ + 20 GB gp3           |          27 |                 27 |
| CloudWatch                                         | logs, about 8 alarms, no Container Insights  |           2 |                 10 |
| Secrets Manager                                            | $0.40 per secret, none in the socle; a phase's containers and the accounts' keys | 0–6 |
| AWS WAF, GuardDuty, CloudTrail                     | none                                         |           0 |               ≈ 15 |
| ECR, S3, SSM, SNS, flow logs, CloudFront           | small volumes, CloudFront's free tier        |           3 |                  8 |
| **Total**                                                  |                                                                              |   **≈ 145** |

Not checked against AWS's price list (this repository never calls AWS to write it): the idle load balancer's capacity
units. What moves it: each extra API
task (+12 with its public IP), `task_egress = "nat"` (+30), `waf_enabled` (+10, if the account accepted it), the
calls a phase adds to a paid service (an AI provider, a geocoder), billed by it and not by AWS. Paused (below),
about 25 remain (load balancer, storage, secrets).

### Credentials: `aws login`, and Terraform in Docker

`aws login --profile omnipotent` (AWS CLI 2.32 or later) signs the CLI in with the console session. It keeps the
session in `~/.aws/login/cache/`; the CLI and the SDKs refresh its credentials every 15 minutes, for up to 12 hours,
then `aws login` again. Terraform 1.16 (its S3 backend) and the AWS provider 6.68 read such a profile (its
`login_session` key): both carry the SDK's `logincreds` provider. A refresh **writes** the new token back to the cache
file, and fails if it cannot: Docker must mount `~/.aws/login` **read-write** (a read-only mount breaks an apply 15
minutes in), `~/.aws/config` read-only. `aws configure export-credentials --profile omnipotent --format env` is no
alternative: it hands over the current short-lived credentials (the CLI renews them every 15 minutes) without the means
to renew them, and a first apply lasts 20 to 30 minutes.

Define this function in the shell (zsh or bash), from the repository root, before the steps below:

```sh
# Terraform 1.16 in Docker, with the aws login session of the profile omnipotent. tf <directory under infra/> <args>
tf() {
  local dir="$1"; shift
  local tty=-i; [ -t 1 ] && tty=-it
  docker run --rm "$tty" \
    -v "$PWD/infra:/infra" -w "/infra/$dir" \
    --mount "type=bind,src=$HOME/.aws/config,dst=/root/.aws/config,readonly" \
    --mount "type=bind,src=$HOME/.aws/login,dst=/root/.aws/login" \
    -e AWS_PROFILE=omnipotent \
    hashicorp/terraform:1.16 "$@"
}
```

`--mount` refuses a missing `~/.aws/login` ("bind source path does not exist": run `aws login` first) instead of
creating it as an empty directory. Without a terminal (`$(tf … output -raw …)`) the function runs Docker without a TTY,
so captured values carry no carriage return.

(A Terraform installed on the Mac works the same: `AWS_PROFILE=omnipotent terraform -chdir=infra/envs/test …`. Do not
mix both in one directory without `init` again: they keep different provider builds in `.terraform/`.)

### Steps

Commands from the repository root. Needs Docker Desktop running, the AWS CLI 2.32 or later (`aws --version`), git,
jq and curl. Allow about an hour and a half the first time, mostly waiting.

**1. Sign in.**

```sh
aws login --profile omnipotent                       # browser; region eu-north-1 if asked
aws sts get-caller-identity --profile omnipotent     # "Account": "903305161052"
export AWS_PROFILE=omnipotent
```

**2. Spend limit, before creating anything.** [AWS Settings](https://settings.aws.com) → **Billing** → **Cost by
project** → **Spend limit** → **Set limit** for the project → custom amount → **Set spend limit**. The limit covers the
**whole account**, the user's other projects included: take their usual monthly cost, add about 80 USD for this test
environment (more while testing heavily), and keep a margin (the minimum AWS accepts is 20 USD or its own estimate,
whichever is higher). AWS e-mails at 50, 75 and 90 % and when the forecast crosses the limit. When the limit is
**reached, AWS pauses the project and stops all its resources**, other projects included (data kept; reactivate by
raising the limit; after 90 days without action, AWS deletes the project's data). Leave the early cost controls off:
they act on the whole account too ("Stop new resource launches" also refuses `secretsmanager:CreateSecret`, which the
backend calls when an ad account is connected, and `ecs:CreateService`; "Pause idle resources" and "Pause top cost
drivers" may stop the other projects' EC2 and RDS). No AWS budget in Terraform here (`monthly_budget_usd` stays
unset): it would watch the whole account too.

**3. The state bucket** (once for this account; its own Terraform workspace, `test`, keeps its local state apart from
production's):

```sh
tf bootstrap init
tf bootstrap workspace select -or-create test
tf bootstrap apply                                      # 7 to add: the bucket omnipotent-tfstate-903305161052; yes
```

The workspace `test` refuses any other account. Its state is `infra/bootstrap/terraform.tfstate.d/test/terraform.tfstate`
(git-ignored): keep a copy. Production's bootstrap later runs in the workspace `default`
(`tf bootstrap workspace select default`), in production's account.

**4. The test stack.**

```sh
cp infra/envs/test/terraform.tfvars.example infra/envs/test/terraform.tfvars
#   edit it: super_admin_emails (your sign-in e-mail), alarm_email if wanted
tf envs/test init
tf envs/test plan -out=test.tfplan                      # *.tfplan is git-ignored: a plan holds secret values
tf envs/test apply test.tfplan
tf envs/test output
```

Read the plan before applying: only additions, every name `omnipotent-test…` (or `omnipotent/test/…`), and no
`module.guardduty`, `module.github_oidc`, `module.waf`, `module.audit_trail` or `aws_acm_certificate`. The apply takes 20 to 30 minutes (the database, the CloudFront VPC origin and distributions are the slow
ones). Until the first deploy (step 7) the ECS services cannot start: their first task definition points at an image
tag (`bootstrap`) that does not exist yet, which is expected. If AWS refuses something, the apply stops on an
`AccessDenied` naming the action: send it as is; nothing outside the stack is touched, and `tf envs/test apply` again
resumes once fixed. The one new kind of resource for this account is the CloudFront VPC origin, whose service-linked
role CloudFront creates at its first use (`iam:CreateServiceLinkedRole` is allowed).

**5. Secrets.** None to fill: the socle declares no container (`module "secrets"` takes an empty map). The phase
that needs a credential declares its container in `envs/prod/main.tf`, and its value is put by hand afterwards, with
the commands of [step 4 of the first installation](#4-secret-values) and `omnipotent/test/` instead of
`omnipotent/prod/`.

**6. Auth0** (tenant `dev-3rwjfrn4yf3tar80.eu.auth0.com`). `tf envs/test output auth0_settings` lists the values.

1. **Applications** → the Single Page Application → **Settings**: **add** (keep the existing entries,
   comma-separated) the Swagger UI's redirect `<api_url>/documentation/static/oauth2-redirect.html` to _Allowed
   Callback URLs_. **Save**. Refresh token rotation stays on. The other URLs come with `cors_origins`, when a front
   end consumes this environment.
2. **APIs** → **Create API**: name `Omnipotent MCP (test)`, identifier **exactly** the test MCP URL (`mcp_url`,
   `https://dyyyy.cloudfront.net/mcp`), signing RS256. Then in its settings _Allow Offline Access_ on, and under
   **Permissions** add `mcp:use`. Auth0 cannot change an identifier: a new test stack (new CloudFront domains after a
   destroy) needs a new API.
3. The REST API of Omnipotent (`auth0_audience`) does not change.

**7. Deploy** (builds the image, migrates, starts the services; 10 to 20 minutes the first time):

```sh
infra/scripts/deploy.sh test --plan                     # reads everything, changes nothing
infra/scripts/deploy.sh test                            # type "test" to confirm
```

The script ([below](#infrascriptsdeploysh)) does what the deploy workflow does, from the Mac, with `AWS_PROFILE`. An
Apple Silicon Mac builds the ARM64 image natively; an Intel Mac emulates it (several times slower).

**8. Check.**

```sh
API_URL="$(tf envs/test output -raw api_url)"
curl -fsS "$API_URL/readyz"; echo                        # {"status":"ok",...}: app, postgres and queue
curl -fsS "$API_URL/status"; echo                        # app_version ends with the deployed commit
curl -fsS "$API_URL/.well-known/oauth-protected-resource/mcp"; echo   # the MCP discovery document
open "$API_URL/documentation"                            # Swagger UI ("Authorize" signs in through Auth0)
```

The logs: `aws logs tail /ecs/omnipotent-test/api --follow` (and `worker`, `migrate`).

### Afterwards

- **Deploying again**: commit, then `infra/scripts/deploy.sh test` (`--ref <commit>` for another commit, an older one
  rolls back; a commit already built reuses its image). Uncommitted changes are never deployed.
- **Changing the infrastructure**: in `envs/prod` (shared) or `envs/test/test_override.tf` / `terraform.tfvars` (test
  only), then `tf envs/test plan -out=test.tfplan` and `tf envs/test apply test.tfplan`. A change of the task
  definitions reaches the tasks at the next deploy ([Changing the infrastructure](#changing-the-infrastructure)).
- **The session expired** (after 12 hours, or `aws logout`): `aws login --profile omnipotent` again.
- **Pausing** between test sessions, to keep about 25 USD a month (the load balancer, the storage, the secrets):

  ```sh
  tf envs/test apply -var api_min_count=0 -var api_max_count=0
  aws ecs update-service --cluster omnipotent-test --service api --desired-count 0 --query service.desiredCount
  aws ecs update-service --cluster omnipotent-test --service worker --desired-count 0 --query service.desiredCount
  aws rds stop-db-instance --db-instance-identifier omnipotent-test --query DBInstance.DBInstanceStatus
  # Resume: the database first (AWS also restarts it by itself after 7 days), then the tasks.
  aws rds start-db-instance --db-instance-identifier omnipotent-test --query DBInstance.DBInstanceStatus
  aws rds wait db-instance-available --db-instance-identifier omnipotent-test
  tf envs/test apply
  aws ecs update-service --cluster omnipotent-test --service api --desired-count 1 --query service.desiredCount
  aws ecs update-service --cluster omnipotent-test --service worker --desired-count 1 --query service.desiredCount
  ```

### Removing the test environment

```sh
tf envs/test destroy                                     # lists everything it deletes; yes
```

It takes 15 to 30 minutes. Everything the stack created goes, data included: the database (no final snapshot), the
buckets with their files, the images, the secrets (at once: the same names can be created again right away), the
CloudFront distributions and the VPC. If it stops on a `DependencyViolation` about a subnet or a security group,
CloudFront is still removing the network interfaces of its VPC origin: run it again a few minutes later.

What survives, on purpose or because Terraform never created it:

- **the state bucket** `omnipotent-tfstate-903305161052` (it refuses to be destroyed: `prevent_destroy`) and the
  bootstrap's local state; a few cents a month. To remove it too: S3 console → the bucket → **Empty**, then **Delete**,
  then delete `infra/bootstrap/terraform.tfstate.d/test/`;
- **the secrets the backend created** under `omnipotent/test/<organization id>/…` (keys of the ad accounts and the
  of a phase), 0.40 USD a month each:

  ```sh
  aws secretsmanager list-secrets --filters Key=name,Values=omnipotent/test/ --query 'SecretList[].Name' --output text
  aws secretsmanager delete-secret --secret-id <name> --force-delete-without-recovery     # for each
  ```

- the **task definition revisions** (free; ECS console → Task definitions → `omnipotent-test-*` → deregister and
  delete if wanted), and maybe the log group `/aws/rds/instance/omnipotent-test/postgresql` if the database wrote to it
  while it was being deleted;
- the **service-linked roles** AWS created (shared by the account, as AWS intends);
- in **Auth0**: the test URLs of the SPA and the API `omnipotent MCP (test)`; remove them by hand.

### Risks for the other projects of the account

- **The spend limit is the account's** (step 2): reaching it stops every resource of the account, the other projects'
  too. Set it with their costs in mind; watch AWS's e-mails at 50, 75 and 90 %.
- **Shared quotas** of the region: VPCs (5 by default: this stack adds one, `10.0.0.0/16`, never peered), Fargate
  vCPUs, RDS instances, CloudFront distributions. Elastic IPs: none in test.
- Terraform only changes what is in its state: what it created, named `omnipotent-test…`, in an account it is pinned
  to. It reads, without changing them, the account id, the zones, CloudFront's managed policies and prefix list, and
  the Elastic Load Balancing account of the region. The buckets `omnilor.com` and `popy-sauvegardes-903305161052`, the
  role `popy-test-serveur`, the certificate of `omnilor.com` (us-east-1) and the AWS-managed roles are never read or
  touched (no custom domain in test).
- `force_destroy` makes `terraform destroy` delete this stack's data without asking twice: never point `envs/test` at
  data that matters (it is refused for prod).

### infra/scripts/deploy.sh

```text
infra/scripts/deploy.sh <environment> [--ref <commit>] [--plan] [--yes] [--region <region>]
```

What `.github/workflows/deploy.yml` does, from a machine, with the profile of `AWS_PROFILE` (the workflow stays the
production path):

1. checks the tools, the AWS session (and says to `aws login` when it has expired), the commit, and reads the SSM
   parameters `/omnipotent/<environment>/deploy/*` (the same as the workflow; a wrong account has none);
2. prints the plan (account, commit, image, task families, URLs); `--plan` stops there; otherwise it asks to type
   the environment's name (`--yes` skips it);
3. exports the commit with `git archive` (never the working tree), builds the backend image for `linux/arm64` with
   `docker buildx` and pushes it to the environment's ECR repository, tagged with the commit SHA (not rebuilt if that
   tag exists);
4. registers a migration revision (the latest one with the new image) and runs it as a one-off task (public IP when
   `migrate-assign-public-ip` says so), prints its logs, and **stops if it fails**: services untouched;
5. registers the API and worker revisions, updates both services, waits until they are stable on them (up to 30
   minutes), and fails if the circuit breaker rolled one back;
6. smoke test: `/readyz` and `/status` (naming the commit); a failure there exits 1 too.

`--ref` deploys another commit; for `prod` it must be on `origin/main`, as in the workflow. Shellcheck-clean, bash 3.2
(macOS) compatible.

## First installation

Follow the steps in order. Commands run from the repository root unless stated otherwise.

### 1. AWS account and an admin profile

1. Create the AWS account, protect the root user with MFA and stop using it.
2. Enable IAM Identity Center (region `eu-north-1`), create your user, give it the
   `AdministratorAccess` permission set on the account.
3. Configure the CLI and check:

   ```sh
   aws configure sso --profile omnipotent-admin     # SSO start URL, region eu-north-1
   export AWS_PROFILE=omnipotent-admin
   aws sts get-caller-identity
   ```

Every command below runs with this profile (`export AWS_PROFILE=omnipotent-admin`).

### 2. The state bucket (once per account)

```sh
cd infra/bootstrap
terraform init
terraform apply
terraform output -raw state_bucket      # omnipotent-tfstate-<account id>
cd ../..
```

The bootstrap keeps its own state locally (`infra/bootstrap/terraform.tfstate`, git-ignored): keep it
somewhere safe. Losing it only means `terraform import aws_s3_bucket.state <bucket>` before changing the
bucket again.

### 3. The production stack

```sh
cd infra/envs/prod
cp terraform.tfvars.example terraform.tfvars        # fill in: Auth0, super-admins, alarm e-mail, budget
terraform init -backend-config="bucket=<state bucket from step 2>"
terraform plan -out=prod.tfplan                      # *.tfplan is git-ignored: a plan holds secret values
terraform apply prod.tfplan
terraform output                                     # URLs, NAT IP, deploy role, Auth0 settings
```

The first apply takes about 20 minutes (RDS and CloudFront are the slow ones). Then:

- confirm the subscription e-mail AWS sends to `alarm_email`;
- until the first deploy (step 7) the ECS services cannot start: their first task definition points at
  an image tag (`bootstrap`) that does not exist yet. The "no running task" alarms fire meanwhile; that
  is expected.

`terraform.tfvars` holds no secret but is git-ignored (it is environment-specific). Keep a copy outside
the repository.

With the custom domain, go through its two stages now ([Custom domain](#custom-domain-cloudflare)), before Auth0
(step 6) and the first deploy (step 7): both then get the final addresses at once.

### 4. Secret values

The socle declares **no secret**: `module "secrets"` takes an empty map, so Terraform creates no container, and
`terraform output secrets_to_fill` is empty. Nothing to do at this step yet.

Each phase that needs a credential declares its container in `envs/prod/main.tf`, lists it in the task role
(`read_only_secret_arns` for one filled by hand, `app_written_secret_arns` for one the backend writes back) and, when
a service must read it at start, in `local.app_secrets`. **No value ever goes through Terraform**: after the apply,
put it with the admin profile, never in a file that could be committed and never in the chat.

```sh
# A key typed without echo, kept out of the shell history.
read -rs SECRET && aws secretsmanager put-secret-value \
  --secret-id omnipotent/prod/<name> --secret-string "$SECRET"; unset SECRET

# A JSON credential, from a temporary file.
aws secretsmanager put-secret-value \
  --secret-id omnipotent/prod/<name> --secret-string file://credentials.json && rm credentials.json
```

A secret injected at task start (`local.app_secrets`) must have a value **before the first deploy**: ECS refuses to
start a task whose injected secret is empty. One the backend only reads at run time (`SecretStore`) answers
`secret_missing` until it is filled, and nothing else breaks.

The credentials of the platform accounts of an Organization are written by the backend itself under
`omnipotent/prod/<organization id>/…` when an account is connected; the task role is scoped to that shape only.

### 5. GitHub

The deploy role only trusts a job of the `production` environment running on `main`. GitHub must put
both in the OIDC token, which takes a custom subject template on the repository (once):

```sh
gh api -X PUT repos/MultiSearchAd/omnipotent/actions/oidc/customization/sub --input - <<'EOF'
{ "use_default": false, "include_claim_keys": ["repo", "context", "ref"] }
EOF
gh api repos/MultiSearchAd/omnipotent/actions/oidc/customization/sub   # check
```

The subject then reads `repo:MultiSearchAd/omnipotent:environment:production:ref:refs/heads/main`,
exactly what the role accepts (`terraform output github_settings`).

Then the two variables the workflow reads (`terraform output deploy_role_arn`):

```sh
gh variable set AWS_DEPLOY_ROLE_ARN --body "<deploy role ARN>"
gh variable set AWS_REGION --body eu-north-1
```

Optional: a Docker Hub account for the pulls of the base image (see [CI and dependencies](#ci-and-dependencies); not
needed on GitHub-hosted runners). Create a personal access token with the _Public Repo Read-only_ scope (Docker Hub →
Account settings → Personal access tokens), then:

```sh
gh variable set DOCKERHUB_USERNAME --body "<Docker Hub user>"
gh secret set DOCKERHUB_TOKEN          # paste the token when asked: never on the command line
```

Without them, the login steps are skipped.

> **GitHub plan.** The `MultiSearchAd` organization is on the Free plan and the repository is
> private: GitHub then does not let you _configure_ environments (environment variables, required
> reviewers, branch rules). That is why the variables above are set at the **repository** level
> (`vars.*` falls back to them). The `production` environment named by the jobs and the restriction to
> `main` are still enforced by AWS through the subject. On GitHub Team, you may instead create the
> environment `production` (Settings → Environments), restrict it to `main`, add required reviewers and
> move the two variables into it (`gh variable set … --env production`). If a run fails at
> "Configure AWS credentials" with _Not authorized to perform sts:AssumeRoleWithWebIdentity_, the
> token's subject differs from what the role accepts: CloudTrail (Event history, event
> `AssumeRoleWithWebIdentity`) shows the subject GitHub sent. If GitHub leaves the environment out on
> this plan, the subject is `repo:MultiSearchAd/omnipotent:ref:refs/heads/main:ref:refs/heads/main`:
> put it in `github_oidc_subjects` (`terraform.tfvars`) and apply.

### 6. Auth0

`terraform output auth0_settings` lists the values.

1. **Single Page Application** (the one of `auth0_spa_client_id`): add each origin of `cors_origins` to _Allowed
   Callback URLs_, _Allowed Logout URLs_ and _Allowed Web Origins_ — none until a front end consumes this API. Keep
   refresh token rotation on. The Swagger UI is off in production (`docs_enabled = false`); only while it is on, add
   `<api URL>/documentation/static/oauth2-redirect.html` to _Allowed Callback URLs_ (`terraform output
   auth0_settings` lists it then), and remove it when it is off again.
2. **REST API**: Omnipotent's own API in the shared tenant (its identifier is `auth0_audience`; _Allow Offline
   Access_ on). It is not multi-search's: a token of one is never accepted by the other (D42).
3. **MCP API**: create a new API whose identifier is exactly the MCP URL
   (`https://<api domain>/mcp`, `https://omnipotent.omnilor.com/mcp` with the custom domain), RS256, _Allow Offline Access_,
   permission `mcp:use`. Auth0 cannot change the identifier of an API: for another URL, create another API.

### 7. First deploy

GitHub → Actions → **deploy** → _Run workflow_ on `main` (or `gh workflow run deploy.yml --ref main`).
It builds the ARM64 image of the commit and pushes it to ECR (tag = commit SHA), runs the migrations
as a one-off ECS task (and stops if they fail; the same task creates or updates the database role of the
application, see [Database access](#database-access)), registers the new API and worker revisions, waits
for the services to be stable on them, and fails if the circuit breaker rolled one back.

**It will fail until omnipass answers** (D43): with `NODE_ENV=prod` the API and the worker refuse to start with
anything but `access_provider = "omnipass"`, and the message says so. That is deliberate — the local implementation
grants every Organization to every caller.

### 8. Check

```sh
API_URL=$(terraform -chdir=infra/envs/prod output -raw api_url)
curl -fsS "$API_URL/readyz"     # {"status":"ok",...}: app, postgres and queue
curl -fsS "$API_URL/status"     # version = the deployed commit
```

`curl -fsS "$API_URL/.well-known/oauth-protected-resource/mcp"` answers the discovery document an MCP client reads
before signing in. The Swagger UI (`/documentation`) and the OpenAPI document (`/documentation/json`) answer 404 in
production: the routes of the API are not public knowledge. To explore the API for a while, set
`docs_enabled = true`, apply, re-run the deploy on the same commit (the task definitions change at the next deploy),
add the Auth0 callback of step 6, and undo all three afterwards. Locally they stay on (`config/default.json`).

## Custom domain (Cloudflare)

Without a domain, the API answers on its `*.cloudfront.net` address. With `domain_name = "omnilor.com"`,
it moves to a subdomain:

| Hostname          | Serves                                | Distribution |
| ----------------- | ------------------------------------- | ------------ |
| `omnipotent.omnilor.com` | the API and the MCP endpoint (`/mcp`) | the API's    |

The labels are `domain_subdomains` (default `{ api = "api" }`). The DNS zone stays at Cloudflare: Terraform
**never touches it** and outputs the records to add by hand (`terraform output dns_records`). A phase serving public
files to a client's site or to a platform adds its own label here, and turns the dormant distribution of
`modules/api-edge` on by passing its alias.

It goes in **two stages**, because a certificate is only issued once its validation record is in the zone, and
CloudFront refuses a certificate that is not `ISSUED`:

- **stage 1** (`domain_name`) requests the certificate and changes nothing else;
- **stage 2** (`domain_certificates_validated = true`), once it is issued, puts the hostname on the distribution and
  moves every public URL to it. It is refused while the certificate is not `ISSUED`, and the error says what to fix.

### Stage 1: the certificate

1. In `terraform.tfvars`: `domain_name = "omnilor.com"`.
2. `terraform apply` (it only creates the certificate), then `terraform output dns_records`: one record, as
   Cloudflare's form takes it.

   ```hcl
   [
     {
       "fqdn"         = "_3f2a….omnipotent.omnilor.com"
       "name"         = "_3f2a….api"
       "proxy_status" = "DNS only (grey cloud)"
       "purpose"      = "Stage 1: validation of the certificate of omnipotent.omnilor.com. Keep it: ACM renews the certificate with it."
       "target"       = "_9b1c….xlfgrmvvlj.acm-validations.aws"
       "type"         = "CNAME"
     },
   ]
   ```

3. Check the zone's CAA records, then add the record in Cloudflare (both below).
4. Wait for ACM, usually a few minutes:

   ```sh
   aws acm list-certificates --region us-east-1 \
     --query 'CertificateSummaryList[].[DomainName,Status]' --output table
   ```

   It must say `ISSUED`. A certificate left 72 hours without its record turns `VALIDATION_TIMED_OUT`, one refused by
   a CAA record `FAILED`: fix the record, then `terraform apply -replace='aws_acm_certificate.domain["api"]'` and
   compare `terraform output dns_records` with Cloudflare.

### Stage 2: the hostname

1. In `terraform.tfvars`: `domain_certificates_validated = true`.
2. `terraform plan`: the API distribution gets its hostname and certificate, and the public URLs of the backend
   change. Nothing is destroyed.
3. `terraform output dns_records` now lists two records: the validation record (keep it for good: ACM renews the
   certificate with it, automatically, before it expires) and a new `api`, a CNAME to its distribution
   (`dxxxx.cloudfront.net`). Add the new one in Cloudflare, the same way.
4. `terraform apply`, then check (below) and finish with Auth0 and a deploy ([After stage 2](#after-stage-2)).

### Adding a record in Cloudflare

For each record of `dns_records` not yet in the zone:

1. [dash.cloudflare.com](https://dash.cloudflare.com) → the account → the domain `omnilor.com` → **DNS** →
   **Records** → **Add record**.
2. **Type**: `CNAME`.
3. **Name**: the record's `name` (`_3f2a….omnipotent`, `omnipotent`…); Cloudflare adds `.omnilor.com` itself (its `fqdn` works
   too).
4. **Target**: the record's `target`, copied whole.
5. **Proxy status**: click the orange cloud so that it turns **grey: _DNS only_**. Cloudflare proxies a new CNAME by
   default, and a proxied record breaks everything here: a validation record then answers Cloudflare's addresses
   instead of its target, so ACM never issues the certificate; a hostname would go through Cloudflare before
   CloudFront (Cloudflare's certificate, a second cache in front of CloudFront's, and Cloudflare's addresses instead of
   the visitors' for the WAF's and the API's rate limits per IP).
6. **TTL**: _Auto_. **Save**.

If Cloudflare says a record of that name exists already, look at it before deleting anything: `api` must not be in
use by the website.

**CAA records.** They list the authorities allowed to issue certificates for the domain (**DNS** → **Records**, type
`CAA`, or `dig +short CAA omnilor.com`). None: nothing to do. Some (for instance `letsencrypt.org` for the website):
Amazon must be allowed too, or the certificate ends `FAILED`. **Add record** → **Type** `CAA`, **Name** `@`, **Tag**
_Only allow hostnames_ (`issue`), **CA domain name** `amazon.com`, **Save**; keep the others. A CAA record on `api`
itself would need the same.

### Checking

```sh
dig +short CNAME _3f2a….omnipotent.omnilor.com @1.1.1.1   # _9b1c….xlfgrmvvlj.acm-validations.aws.
dig +short omnipotent.omnilor.com @1.1.1.1                 # dxxxx.cloudfront.net. first, then CloudFront's addresses
curl -fsS https://omnipotent.omnilor.com/readyz            # {"status":"ok",...}
curl -fsS https://omnipotent.omnilor.com/status            # the deployed commit
```

A record answering Cloudflare's addresses (`104.*`, `172.67.*`) is proxied: set its proxy status to _DNS only_.

### After stage 2

- **Auth0** (`terraform output auth0_settings`): the MCP API's identifier becomes `https://omnipotent.omnilor.com/mcp`.
  Auth0 cannot change an identifier: **create a new API** with the final one, and keep the old one only while a
  client still holds its tokens. The REST API's identifier does not change — it is an identifier, not a URL.
- **Deploy** (step 7): the tasks take their new environment at the next deploy, so the public URLs the backend
  builds (the MCP resource) follow then, not at the apply.
- **`cors_origins`**: a front end consuming the API keeps its own origins; they are unrelated to this hostname.

Where each URL is read:

| Output                                                                            | Without a domain                  | With it                       |
| --------------------------------------------------------------------------------- | --------------------------------- | ----------------------------- |
| `api_url`: the base of every public URL the backend builds                        | `https://yyyy.cloudfront.net`     | `https://omnipotent.omnilor.com`     |
| `mcp_url`: `MCP_RESOURCE_URL` and the identifier of the Auth0 MCP API              | `https://yyyy.cloudfront.net/mcp` | `https://omnipotent.omnilor.com/mcp` |

## Operating

### Deploying

Run the **deploy** workflow. Without input it deploys the head of `main`; the `ref` input deploys
another commit of `main`. A commit already built is not rebuilt (immutable tags). Only one deploy runs
at a time.

### Rolling back

Run the **deploy** workflow with `ref` = the SHA of the previous good commit (the last 30 images are
kept in ECR). Its image is reused. Migrations are **not** reverted: the old code
runs on the newer schema, which works as long as migrations only add things. When a migration must be
undone, write a new migration that reverts it and deploy forward.

A deploy whose tasks never turn healthy is rolled back by ECS itself (deployment circuit breaker), and
the workflow fails.

### Changing the infrastructure

`terraform plan` then `terraform apply` in `infra/envs/prod`. Good to know:

- **Task definitions.** Terraform owns their content (environment, secrets, roles, CPU, memory) and
  registers a revision when it changes; the deploy registers the next ones from the latest revision with
  only the image swapped. The services ignore `task_definition` in Terraform (`ignore_changes`), so a
  change made in Terraform reaches the running tasks **at the next deploy** (re-run the deploy on the
  same commit to apply it at once: the image is reused). Without that, Terraform would move the services
  back to its own revision and its `bootstrap` image at every apply.
- **Desired count.** Also ignored: the autoscaling (API, 1 to 4 tasks on 60 % CPU) owns it, and
  Terraform must not reset it at each apply. To change the worker count, use the console or
  `aws ecs update-service --desired-count`.
- If a change **recreates** a service (rare: network or load balancer settings), set `image_tag` to the
  SHA currently deployed first, so that the recreated service starts on a real image.

### Shutdown, draining and timeouts

- Stopping an API task (deploy, scale-in): ECS first deregisters it from the target group and waits for
  its in-flight requests (deregistration delay 60 s, the CloudFront origin read timeout) **before**
  sending SIGTERM. The backend then keeps serving `APP_DRAIN_DELAY` = 5 s, closes within
  `APP_SHUTDOWN_TIMEOUT` = 20 s, and ECS kills it after the 30 s stop timeout.
- The worker: no load balancer, so `APP_DRAIN_DELAY` = 0; pg-boss lets running jobs finish for up to
  30 s, `APP_SHUTDOWN_TIMEOUT` = 45 s, stop timeout 60 s. An interrupted job is retried by pg-boss.
- **Long requests.** CloudFront waits at most 60 s for the API (more needs an AWS quota increase, up
  to 180 s, then `cloudfront_origin_read_timeout`). A route that may run longer than that answers
  asynchronously (a job, then polling) rather than holding the connection, so it is
  not affected. An MCP client calling the generation synchronously may get a 504 after 60 s although the
  generation finishes and is kept in the history (read it with the list of generations). An
  asynchronous generation running in an API task that stops (deploy, scale-in) is interrupted and
  marked failed after 10 minutes.

### Database access

The API and the worker do not use the master user. They sign in as `omnipotent_app`
(`db_app_username`) with **RDS IAM authentication**: for every new connection, the backend signs a
15-minute token with the task role (`rds-db:connect` on that user only; `DB_IAM_AUTH=true`); no password
is stored or injected anywhere for them. The role may read and write the rows of the application tables
(no `CREATE`, `ALTER` or `DROP` on them: only the migrations change the schema) and owns the `pgboss`
schema of the job queue (pg-boss creates a partition per queue at run time).

The migration task connects as the master user (its password injected from the RDS-managed secret) and,
after the migrations, creates or updates that role at every deploy (`DB_APP_USER`,
`backend/src/database/app-role.ts`): login, `rds_iam`, the grants on the tables (default privileges cover
the tables of later migrations), the `pgboss` schema and everything in it. The migration task has its
own IAM role, with no permission (no bucket, no secret).

- **Switching an existing installation** to it: `terraform apply -var db_apply_immediately=true` (RDS
  otherwise turns IAM authentication on only in the next maintenance window; no restart), check
  `aws rds describe-db-instances --db-instance-identifier omnipotent-prod --query 'DBInstances[0].IAMDatabaseAuthenticationEnabled'`
  says `true`, then deploy: the migration task creates the role before the new API and worker tasks start.
- `rds_iam` **turns password login off** for that role: it can only sign in with IAM tokens.
- **Rolling back** to the master user (an IAM sign-in problem): set `db_iam_auth = false` in
  `terraform.tfvars`, `terraform apply`, then re-run the deploy on the same commit (the task definitions
  change at the next deploy). The API and the worker then use the master user and its injected password
  again, and the redeploy after each password rotation comes back. The role stays in the database; set
  `db_iam_auth = true` and deploy to return to it (the migration step gives it back the queue tables the
  master user created meanwhile).
- A `psql` session as the application role (from a bastion with the task role):
  `PGPASSWORD="$(aws rds generate-db-auth-token --hostname <host> --port 5432 --username omnipotent_app)" psql "host=<host> dbname=omnipotent user=omnipotent_app sslmode=verify-full sslrootcert=global-bundle.pem"`.

### Database password rotation

RDS rotates the master password itself (`db_password_rotation_schedule`, default 03:00 UTC on the 1st
of each month). With IAM authentication only the migration task uses it, and reads it when it starts:
nothing to do. Without (`db_iam_auth = false`), ECS injects `DB_PASSWORD` when a task starts, so the
running tasks would keep the old one: the `db-rotation-restart` module (created only then) catches the
`RotationSucceeded` event (delivered by CloudTrail) and forces a new deployment of `api` and `worker`,
whose new tasks read the new password. Expect a couple of minutes of database errors on the old tasks
during that window. If the redeploy fails, the alarm `…-db-rotation-redeploy-failed` fires: run
`aws ecs update-service --cluster omnipotent-prod --service api --force-new-deployment` (and the same
for `worker`).

### Logs and alarms

- Logs: CloudWatch log groups `/ecs/omnipotent-prod/{api,worker,migrate}` (30 days),
  `/aws/rds/instance/omnipotent-prod/postgresql`.
  `aws logs tail /ecs/omnipotent-prod/api --follow`.
- Access logs, in the bucket `terraform output access_logs_bucket` (`access_logs_retention_days`, 90
  days): `cloudfront/api/` and, once a phase turns the second host on, `cloudfront/tracking/` (CloudFront
  standard logs: one gzipped line per request with the client IP, method, path, status, edge, timings), `alb/AWSLogs/<account>/…` (load balancer),
  `vpc-flow/AWSLogs/<account>/vpcflowlogs/<region>/<yyyy>/<mm>/<dd>/` (VPC flow logs, below).
  Read them with Athena (AWS documents the table definitions of these formats) or
  `aws s3 cp --recursive s3://<bucket>/cloudfront/api/ .`. The API also writes one line per request in its
  own log, with the client IP taken from `CloudFront-Viewer-Address` (`TRUST_CLOUDFRONT_VIEWER_ADDRESS`).
- VPC flow logs (`enable_flow_logs`, on by default): every network interface of the VPC (load balancer, NAT gateway,
  tasks, database, endpoints), accepted and rejected traffic, one line per flow and 10-minute window in AWS's default
  format (version 2: interface, source and destination addresses and ports, protocol, packets, bytes, start, end,
  `ACCEPT` or `REJECT`), gzipped text files delivered about every 10 minutes. They answer "who talked to what": a scan
  of the NAT gateway's address, an unexpected destination of the tasks, what the database refused.
- Alarms (to the SNS topic and the e-mail): ALB 5xx rate and backend 5xx rate above 5 % (with at least
  20 requests in 5 minutes), an unhealthy API target for 5 minutes, no running `api` or `worker` task
  for 3 minutes (needs Container Insights), database CPU above 80 % for 15 minutes, free storage under
  2 GB, freeable memory under 128 MB, failed redeploy after a password rotation; optionally the monthly
  budget (80 % actual, 100 % forecast); the GuardDuty findings of medium severity and above (below).

### Security at the edge

- **AWS WAF** (`modules/waf`, one web ACL of scope CLOUDFRONT in us-east-1, on every distribution;
  `waf_enabled`, off in the test environment, whose account refuses it). Rules, in order:
  1. `public-rate-per-ip`: a client IP may send `waf_public_rate_limit` (600) requests per
     `waf_rate_limit_window` (5 minutes) to the anonymous routes (`public_path_prefixes`: `/livez`,
     `/readyz`, `/healthz`, `/status`, `/.well-known/`), since a flood there costs database connections
     without any sign-in. A phase adding a public route adds its prefix;
  2. `rate-per-ip`: `waf_rate_limit` (3000) requests per 5 minutes per IP, every route of every
     distribution (an office behind one address included: 10 requests a second on average);
  3. `known-bad-inputs` (AWS managed: Log4j, Java deserialization, exploitable paths…);
  4. `common` (AWS managed core rule set). `SizeRestrictions_BODY` (bodies over 8 KB, which an MCP call or
     a file upload exceeds), `SizeRestrictions_QUERYSTRING` (query strings over 2 KB, which a long list of
     ids exceeds) and `CrossSiteScripting_BODY` (text a client may legitimately send; the API answers JSON,
     so nothing is interpreted as HTML) are only counted (`waf_common_rules_count_only`).

  Over a limit the client gets **429** (`{"code":"rate_limited",…}`, `Retry-After`) until its rate falls
  back, within about a minute. The API adds its own limit per user. Metrics and sampled requests are on:
  console _WAF & Shield_ → Web ACLs → region Global (CloudFront) → `omnipotent-prod`, or CloudWatch
  (us-east-1, namespace `AWS/WAFV2`). To find a legitimate request that was blocked, look at the sampled
  requests of the rule, then raise its limit or add the managed rule to `waf_common_rules_count_only`.
  `waf_logging_enabled = true` logs the blocked and counted requests (Authorization header redacted) to
  the CloudWatch log group `aws-waf-logs-omnipotent-prod` in us-east-1 (paid ingestion).

- **Security headers of the API** (`modules/api-edge`): the managed `SecurityHeadersPolicy` (HSTS,
  `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`), no CSP (the API answers JSON, and the
  Swagger UI brings its own inline code). The second, dormant host of the module keeps the same headers and,
  when a phase turns it on, lets only `GET`/`HEAD` on its own path prefix through to the backend, answering
  404 at the edge to anything else — so a public-file host can never expose the API by construction.
- **TLS.** With the custom domain, each hostname has its ACM certificate and accepts TLS 1.2 and 1.3 only
  (`TLSv1.2_2021`); the `*.cloudfront.net` addresses keep CloudFront's default certificate (TLS 1.0 and up).
- **Client IP.** The API distribution forwards `CloudFront-Viewer-Address` (`<ip>:<port>`, set by
  CloudFront itself) with every viewer header; the backend reads the client IP from it for its access log
  and its rate limits. The dormant host forwards that header only: no cookie, query string or other header
  of its visitors would reach the backend.

### Threat detection (GuardDuty)

`modules/guardduty` turns Amazon GuardDuty on in the region of the stack (`guardduty_enabled`). It reads, without any
agent or log of ours, the CloudTrail management events of the account (stolen credentials, API calls from Tor or known
malicious addresses, unusual IAM changes, a trail or a log turned off), and with the protection plans:

- **S3 Protection** (`guardduty_s3_protection`): the S3 data events of the buckets (unusual reads of the creative
  images, a bucket made public, access from a malicious address);
- **RDS Protection** (`guardduty_rds_protection`): the sign-ins to PostgreSQL (brute force, a client never seen
  before). Its _data activity_ monitoring (unusual volumes read, data deleted, queries from a malicious address;
  $3 per vCPU and month, 6 $ on db.t4g.small) is not known to the AWS provider yet: Terraform leaves it as GuardDuty
  sets it. Check it once in the console (GuardDuty → Protection plans → RDS Protection) and switch it with the
  command below;
- **Runtime Monitoring** (`guardduty_runtime_monitoring`, **off**): GuardDuty adds its agent as a sidecar to every
  Fargate task started afterwards and sees inside the containers (a reverse shell, a crypto miner, a process reading
  credentials, a connection to a malicious address). Off by default for its cost ($2.40 per vCPU and month in
  eu-north-1: about 2.40 $ for the API and the worker at 0.5 vCPU each, 6 $ with 4 API tasks) and its weight: the
  agent takes up to 128 MB of each task's memory (also of the 512 MB migration task), its image is pulled at every
  task start, GuardDuty adds a VPC endpoint and a security group to the VPC (free). The base image is minimal
  (no curl, wget or compiler; non-root user), which already limits what such an attack can do. To turn it on: `true`, apply
  (the execution role may then pull GuardDuty's agent image), re-run the deploy, and check that the cluster's coverage
  is _Healthy_ (GuardDuty → Runtime Monitoring → Runtime coverage).

```sh
# RDS Protection's data activity monitoring on (DISABLED: off), keeping the login activity on.
aws guardduty update-detector --detector-id "$(terraform -chdir=infra/envs/prod output -raw guardduty_detector_id)" \
  --features '[{"Name":"RDS_LOGIN_EVENTS","Status":"ENABLED","AdditionalConfiguration":[{"Name":"RDS_DATA_RISK","Status":"ENABLED"}]}]'
```

The findings of severity `guardduty_alert_min_severity` (4: medium) and above are e-mailed through the alarm topic by
an EventBridge rule, as plain text: severity, title, type, resource, account and region, how many times and when it
was seen, the description and a link to the finding. A finding that keeps happening is updated, and e-mailed again,
every `guardduty_finding_publishing_frequency` (six hours). The low ones stay in the console.

On a finding: open the link, read _Resource affected_ and _Action_. If it is real, act on what it names (revoke an
access key or a session, rotate a secret, stop a task, restore a bucket policy) and keep the finding. If it is
expected (a scanner you run, a new partner address), archive it, or create a suppression rule for it in the console
(GuardDuty → Findings → _Suppress findings_) so that it stops e-mailing. To test the whole chain,
`aws guardduty create-sample-findings --detector-id <id>` creates sample findings of every type (many e-mails).

GuardDuty watches only this region (AWS recommends a detector in every region, for the global services and the
regions you do not use: see "Not done yet"). If the account already has a detector in the region (turned on in the
console), import it before the first apply:
`terraform import 'module.guardduty[0].aws_guardduty_detector.this' <detector id>` (`aws guardduty list-detectors`).
The 30 first days of each protection plan are free (GuardDuty → Usage shows the projected cost).

### Rotating the CloudFront → ALB secret header

`terraform apply -replace=module.alb.random_password.origin_verify`. The ALB rule changes at once and
the CloudFront distribution in a few minutes: expect 403s from the API meanwhile, so do it at a quiet
time.

### Fixed egress IP

The backend calls out through the NAT gateway: `terraform output nat_egress_ips` is the address to give
to the platforms that use allow lists. With `task_egress = "public-ip"` (the test
environment) there is none: each task calls out from its own public IP, which changes at every start.

## Costs

An **estimate** of the monthly cost in `eu-north-1` with the defaults, at low traffic, from the AWS
on-demand prices of October 2026, before taxes and without the free tier of a new account:

| Item                                                       | Assumption                                                                   | USD / month |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------: |
| Fargate ARM64 — API                                        | 1 task × 0.5 vCPU / 1 GB, 24/7 ($0.0356 per vCPU-hour, $0.00392 per GB-hour) |          16 |
| Fargate ARM64 — worker                                     | same                                                                         |          16 |
| NAT gateway                                                | 1 gateway ($0.046/h) + 20 GB processed                                       |          35 |
| Public IPv4 address                                        | 1 (the NAT gateway; the ALB is internal) × $0.005/h                          |           4 |
| Application Load Balancer                                  | $0.0239/h + about 1 LCU                                                      |          23 |
| RDS PostgreSQL                                             | db.t4g.small Single-AZ ($0.033/h) + 20 GB gp3; backups ≤ DB size are free    |          27 |
| CloudWatch                                                 | ~3 GB of logs, ~12 alarms, Container Insights                                |          10 |
| Secrets Manager                                            | $0.40 per secret, none in the socle; a phase's containers and the accounts' keys | 0–6 |
| ECR, S3, CloudTrail, SSM, SNS, Step Functions, EventBridge | small volumes                                                                |           2 |
| CloudFront (1 distribution)                                 | always-free tier: 1 TB out, 10 M requests, 2 M function invocations a month   |           0 |
| ACM certificates (custom domain)                            | 1 public certificate, free (CloudFront only)                                 |           0 |
| AWS WAF                                                    | 1 web ACL ($5) + 4 rules ($1 each) + $0.60 per million requests              |         ≈10 |
| Access logs (S3)                                           | CloudFront standard logs and ALB logs: delivery free, a few GB stored        |          <1 |
| VPC flow logs (S3)                                         | ~1–2 GB a month delivered at $0.271 per GB, kept 90 days gzipped             |          <1 |
| GuardDuty                                                  | 0.4 M events ($4.20/M), S3 events ($0.80/M), RDS login ($1 × 2 vCPU)         |       ≈ 4–5 |
| **Total**                                                  |                                                                              |   **≈ 145** |

What moves it: each extra API task +16; `db_multi_az = true` +24; `nat_gateway_per_az = true` +38
(gateway + IP); a bigger database class (db.t4g.medium ≈ +24); NAT data ($0.046 per GB) as the
platforms' reports grow; Container Insights can be turned off
(`container_insights = "disabled"`, about −8, but the running-task alarms go with it); what a phase adds
(an AI provider, a geocoder, a secret per connected account at $0.40); CloudFront past its free tier (about $0.085
per GB and $1 per million HTTPS requests in Europe and North America), which only a public-file host would reach;
WAF requests ($0.60 per million) and its optional logs (`waf_logging_enabled`, $0.50 per
GB in CloudWatch Logs); GuardDuty, whose first 30 days per protection plan are free: its CloudTrail management events
($4.20 per million: a busier account, many deploys), RDS Protection's data activity if switched on ($3 per vCPU, so
6 more), Runtime Monitoring if switched on ($2.40 per vCPU of the running tasks: 2.40 more with one API task and the
worker, 6 with 4 API tasks); the flow logs grow with the traffic ($0.271 per GB delivered; Parquet would add $0.04 per
GB).
Set `monthly_budget_usd` to be warned. The test environment's estimate: [Monthly cost](#monthly-cost).

## Adding another environment

Do as `envs/test` does ([Test environment](#test-environment-simplified-aws-account)): one configuration, never a copy.

1. `mkdir -p infra/envs/staging && cd infra/envs/staging`, then link the shared files:
   `for f in main.tf variables.tf outputs.tf providers.tf; do ln -s "../prod/$f" "$f"; done`, and copy
   `../prod/.terraform.lock.hcl`.
2. Its own `versions.tf` (copy `envs/test/versions.tf`): the backend `key = "staging/terraform.tfstate"` and the state
   bucket of its account.
3. A `staging_override.tf` whose `variable` blocks only change defaults: `environment = "staging"`,
   `allowed_account_ids`, `ecr_repository_name = "omnipotent-staging-backend"`, the smaller sizes. In production's
   account, also `create_github_oidc_provider = false` (one provider per account), `create_audit_trail = false`,
   `guardduty_enabled = false` (one detector per region) and its own `github_environment`; or
   `github_deploy_role_enabled = false` and `infra/scripts/deploy.sh staging`. With the custom domain, other labels
   (`domain_subdomains = { api = "api-staging" }`) and its own two stages.
4. Everything else is named after `<project>-<environment>`: secrets under `omnipotent/staging/…`, SSM parameters
   under `/omnipotent/staging/deploy`, its own Auth0 settings.
5. Its offline tests (`tests/`, the mocks of `envs/prod/tests/mocks`), and its directory in the `validate` matrix of
   `.github/workflows/infra.yml`. For GitHub deploys, a copy of the deploy workflow with
   `DEPLOY_PARAMETERS_PATH: /omnipotent/staging/deploy`, the environment `staging` and its own `AWS_DEPLOY_ROLE_ARN`.

A separate AWS account is cleaner (no shared quota or IAM): then keep every `create_*` default and only change the
names.

## Not done yet

- TLS 1.2 minimum on the viewer side: only on the custom hostnames ([Custom domain](#custom-domain-cloudflare),
  stage 2). The `*.cloudfront.net` addresses keep CloudFront's default certificate, which still accepts TLS 1.0 and
  1.1; nothing links to them once the domain is in place.
- Required reviews before a production deploy: GitHub Team (protected `main`, reviewers on the
  `production` environment, see step 5).
- OpenTelemetry collector (`APP_TELEMETRY_ENABLED=false`).
- CloudFront → ALB is plain HTTP. The ALB is internal and CloudFront reaches it as a VPC origin, so that hop never
  leaves AWS's private network and the ALB has no public endpoint. To encrypt it too, once the custom domain is in
  place: a regional ACM certificate (eu-north-1) covering `omnipotent.omnilor.com` (one more validation
  record), a 443 listener with the same 403 default and header rule, 443 open to the CloudFront prefix list, the
  VPC origin in `https-only`, then the port 80 listener removed. The API's origin request policy forwards the
  viewer's `Host`, against which CloudFront then checks the ALB's certificate; a second host's would have to
  forward it too.
- No interactive access to the database: it is private and ECS Exec is off. For a `psql` session, add a
  temporary SSM-managed bastion or enable ECS Exec (task role `ssmmessages:*`).
- GuardDuty only in the region of the stack. AWS recommends a detector in every region (activity in a region we do not
  use, the global services): enable it in the other regions from the console, without Terraform, if wanted (only the
  management events are billed there, close to nothing without activity), or with a provider per region.
- RDS Protection's data activity monitoring is switched by hand (see "Threat detection"): the AWS provider (6.68) does
  not know its setting yet.

## CI and dependencies

- Every action of `.github/workflows` is pinned to a commit SHA (the version in a comment); every workflow
  only gets `contents: read`, and only the deploy job, which calls AWS, may request an OIDC token. The
  production image is built without the shared Actions cache.
- Dependabot (`.github/dependabot.yml`) opens weekly PRs for the npm packages of `backend/` (minor and
  patch grouped, majors alone), the base image of `backend/Dockerfile` (pinned by tag and digest) and the
  actions, each release once it is a week old (security fixes at once).
- The image (`backend/Dockerfile`) runs on the Docker official image `node:22.x-trixie-slim` (Debian 13, no compiler,
  ssh, curl or package manager), pinned by tag and multi-architecture digest, as the unprivileged `node` user; the ECS
  health check calls `/livez` with `node -e`. At least Node 22.12: the build is CommonJS and `pg-boss` ships as pure
  ESM, so it needs a `require()` of an ES module (`backend/package.json`, `engines`).
- **Why Docker Hub and not `public.ecr.aws/docker/library/node`.** The public ECR mirror serves the same index under
  the same digest (`docker buildx imagetools inspect` on both), but Dependabot cannot read it: its first run failed
  with `DENIED Not Authorized`, then `429` (ECR Public throttles anonymous clients to about one request a second), and
  the registry credentials of `dependabot.yml` do not work there (Dependabot's proxy sends Basic authentication, ECR
  Public only accepts a bearer token: [dependabot/proxy#157](https://github.com/dependabot/proxy/issues/157); the 429s:
  [dependabot-core#11921](https://github.com/dependabot/dependabot-core/issues/11921), both open). The only working
  setup reported is a private ECR pull-through cache with a long-lived IAM access key stored in GitHub, which this
  repository avoids (OIDC only). Docker Hub is Dependabot's default registry.
- **Docker Hub's pull limits.** Anonymous pulls are limited to 100 per 6 hours per IP address, 200 for a free account
  ([Docker docs](https://docs.docker.com/docker-hub/usage/pulls/)), but GitHub-hosted runners are exempt for public
  images ([GitHub docs](https://docs.github.com/en/actions/reference/limits), "Docker Hub's rate limit for GitHub
  Actions"): CI (`backend.yml`, `ubuntu-latest`) and the deploy (`ubuntu-24.04-arm`) need nothing. The jobs that build
  the image still log in to Docker Hub when the repository has the variable `DOCKERHUB_USERNAME` and the secret
  `DOCKERHUB_TOKEN` (step 5): useful on self-hosted runners or if GitHub's exemption ends. Only whether they exist
  reaches the steps (`DOCKERHUB_LOGIN`), never the token; pull requests of Dependabot and forks get no secret and
  skip the login. The `postgres:17-alpine` service of the integration tests is a public Docker Hub image too.
- **RDS certificate authorities.** The image trusts AWS's RDS CA bundle (`NODE_EXTRA_CA_CERTS`) from
  `backend/certs/rds-global-bundle.pem`, kept in the repository: the build never downloads it, so it is the same
  every time. (It used to be downloaded with a pinned checksum, which broke every build when AWS added the CAs of a new
  region.) `.github/workflows/rds-ca-bundle.yml` compares it every Monday with
  `https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem` and fails, listing the certificates that changed,
  when they differ. Then replace the file with AWS's (the failed run prints the `curl` command), check the diff (AWS
  normally only adds CAs), commit on `main` and deploy. GitHub e-mails the failure of a scheduled run to whoever last
  changed its schedule. A stale bundle keeps working as long as it holds the CA of the database's certificate.

## Local checks

No AWS account is needed for these (CI runs the same in `.github/workflows/infra.yml`). `terraform test` runs
`envs/<env>/tests/offline.tftest.hcl`: a plan and an apply against mocked providers (`envs/prod/tests/mocks`, shared),
which catch what `validate` cannot (a `count` or `for_each` depending on a value only known after apply, a wrong
reference between modules); the test environment's also checks what its account requires (no GuardDuty, no OIDC, no
WAF, names, sizes).

```sh
terraform fmt -check -recursive infra
terraform -chdir=infra/bootstrap init -backend=false && terraform -chdir=infra/bootstrap validate
for env in prod test; do
  terraform -chdir=infra/envs/$env init -backend=false && terraform -chdir=infra/envs/$env validate &&
    terraform -chdir=infra/envs/$env test      # plan + apply against mocked providers, no AWS call
done
(cd infra && tflint --init && tflint --recursive --config "$PWD/.tflint.hcl")
shellcheck infra/scripts/*.sh
```

Or with Docker only:

```sh
docker run --rm -v "$PWD/infra:/infra" -w /infra hashicorp/terraform:1.16 fmt -check -recursive
for dir in bootstrap envs/prod envs/test; do
  docker run --rm -v "$PWD/infra:/infra" -w "/infra/$dir" hashicorp/terraform:1.16 init -backend=false
  docker run --rm -v "$PWD/infra:/infra" -w "/infra/$dir" hashicorp/terraform:1.16 validate
done
docker run --rm -v "$PWD/infra:/infra" -w /infra/envs/prod hashicorp/terraform:1.16 test
docker run --rm -v "$PWD/infra:/infra" -w /infra/envs/test hashicorp/terraform:1.16 test
docker run --rm -v "$PWD/infra:/infra" -w /infra --entrypoint sh ghcr.io/terraform-linters/tflint:v0.64.0 \
  -c 'tflint --init --config /infra/.tflint.hcl && tflint --recursive --config /infra/.tflint.hcl'
docker run --rm -v "$PWD/infra/scripts:/mnt" -w /mnt --entrypoint shellcheck rhysd/actionlint:latest deploy.sh  # the deploy script
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest      # the workflows
```
