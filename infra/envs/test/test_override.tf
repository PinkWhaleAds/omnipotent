# Everything the test environment does differently from production, and nothing else: the defaults of production's
# variables (../prod/variables.tf, linked here), replaced through Terraform's override files. A value set in
# terraform.tfvars still wins over these defaults. Why each one: infra/README.md, "Test environment".
#
# The test AWS account (903305161052, eu-north-1) uses AWS's simplified account experience: an AWS-managed organization
# whose service control policies deny GuardDuty, every IAM identity provider (no GitHub OIDC) and the WAF associations
# in us-east-1, and whose resource control policy refuses S3 writes from accounts outside the organization (CloudFront's
# legacy log delivery). Other projects of the user live in the same account: everything here is named
# omnipotent-test-... (or omnipotent/test/...) and nothing is account-wide.

# --- Identity --------------------------------------------------------------------------------------------------------

variable "environment" {
  default = "test"
}

# The provider refuses any other account: a wrong AWS_PROFILE cannot create the test stack elsewhere.
variable "allowed_account_ids" {
  default = ["903305161052"]
}

# Prefixed like everything else (production's is omnipotent-backend).
variable "ecr_repository_name" {
  default = "omnipotent-test-backend"
}

# --- What the account does not allow, or does not need ----------------------------------------------------------------

# Denied by the organization's SCP (guardduty:* is not among the allowed services).
variable "guardduty_enabled" {
  default = false
}

# Denied by the SCP (iam:*Provider*): no GitHub OIDC provider, hence no deploy role; infra/scripts/deploy.sh deploys.
variable "github_deploy_role_enabled" {
  default = false
}

# A multi-region trail is account-wide (and multi-region features are not supported here); with db_iam_auth it is not
# needed, and CloudTrail's event history (90 days) stays readable.
variable "create_audit_trail" {
  default = false
}

# Not available with CloudFront in this account type (the SCP denies the WAF associations in us-east-1). The API keeps
# its own rate limits per user and per IP.
variable "waf_enabled" {
  default = false
}

# CloudFront's standard logs are written by an AWS account outside the organization, which the resource control policy
# refuses; the load balancer's would check the bucket with a test file at creation. The VPC flow logs stay on.
variable "edge_access_logs_enabled" {
  default = false
}

# --- Cost ------------------------------------------------------------------------------------------------------------

# No NAT gateway (about 35 USD a month): the tasks run in the public subnets with a public IP each; their security group
# only lets the load balancer in. The load balancer (CloudFront VPC origin) and the database stay private.
variable "task_egress" {
  default = "public-ip"
}

variable "api_cpu" {
  default = 256
}

variable "api_memory" {
  default = 512
}

variable "api_max_count" {
  default = 2
}

variable "worker_cpu" {
  default = 256
}

# The heavier jobs (imports, statistics pulls) run in the worker.
variable "worker_memory" {
  default = 1024
}

# The database keeps production's db.t4g.small (2 GB): a db.t4g.micro (1 GB) was tried first and swapped 270 MB with
# the API, the worker and the job queue idle (2026-10-17). A change of the database applies at once in test.
variable "db_apply_immediately" {
  default = true
}

variable "db_max_allocated_storage" {
  default = 50
}

variable "db_backup_retention_days" {
  default = 1
}

# About 8 USD a month less; the "no running task" alarms go with it (the ECS console still shows the tasks).
variable "container_insights" {
  default = "disabled"
}

variable "log_retention_days" {
  default = 7
}

variable "access_logs_retention_days" {
  default = 14
}

# --- A disposable environment ------------------------------------------------------------------------------------------

# terraform destroy removes everything, data included: no deletion protection, no final snapshot, buckets emptied, images
# and secrets deleted at once (the same names can be created again right away).
variable "force_destroy" {
  default = true
}

# --- Testing ------------------------------------------------------------------------------------------------------------

# The Swagger UI on <api_url>/documentation (its Auth0 callback: terraform output auth0_settings).
variable "docs_enabled" {
  default = true
}

# A disposable account holding no real data, and omnipass is not built yet: the backend runs its local
# implementations of the identity and the rights, which let any Auth0 identity with a verified email sign in and
# grant every Organization. NODE_ENV=dev is what the backend's own guard allows that under (D43), and production
# keeps NODE_ENV=prod with omnipass — so a production deploy fails loudly rather than serving everything.
variable "node_env" {
  default = "dev"
}

variable "access_provider" {
  default = "local"
}
