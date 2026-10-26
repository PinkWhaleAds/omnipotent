# ---------------------------------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------------------------------

variable "region" {
  description = "AWS region of the environment."
  type        = string
  default     = "eu-north-1"
}

variable "project" {
  description = "Project name: prefix of the resource names, the secrets and the SSM parameters."
  type        = string
  default     = "omnipotent"
}

variable "environment" {
  description = "Environment name (prod, test...): in the resource names (<project>-<environment>-...), the secrets and the SSM parameters."
  type        = string
  default     = "prod"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,9}$", var.environment))
    error_message = "environment is a short lower-case name (2 to 10 letters or digits), e.g. prod or test."
  }
}

variable "allowed_account_ids" {
  description = "AWS accounts this stack may be planned and applied in: the AWS provider refuses any other (a guard against the wrong AWS_PROFILE). Empty: any account."
  type        = list(string)
  default     = []
  nullable    = false

  validation {
    condition     = alltrue([for id in var.allowed_account_ids : can(regex("^[0-9]{12}$", id))])
    error_message = "allowed_account_ids holds 12-digit AWS account ids."
  }
}

variable "force_destroy" {
  description = "A disposable environment: terraform destroy then deletes the data too (the buckets with their objects, the image repository with its images, the secrets at once without recovery window, the database without final snapshot and with its automated backups), and the database has no deletion protection. Refused for prod."
  type        = bool
  default     = false
  nullable    = false

  validation {
    condition     = !var.force_destroy || var.environment != "prod"
    error_message = "force_destroy is for disposable environments (test), never for prod."
  }
}

# ---------------------------------------------------------------------------------------------------
# Auth0 and access (required)
# ---------------------------------------------------------------------------------------------------

variable "auth0_domain" {
  description = "Auth0 tenant domain (AUTH0_DOMAIN, VITE_AUTH0_DOMAIN), e.g. tenant.eu.auth0.com."
  type        = string

  validation {
    condition     = var.auth0_domain != "" && !startswith(var.auth0_domain, "http")
    error_message = "auth0_domain is a bare domain such as tenant.eu.auth0.com."
  }
}

variable "auth0_audience" {
  description = "Identifier of the Auth0 API of the REST API (AUTH0_AUDIENCE, VITE_AUTH0_AUDIENCE)."
  type        = string

  validation {
    condition     = var.auth0_audience != ""
    error_message = "auth0_audience is required."
  }
}

variable "auth0_spa_client_id" {
  description = "Client id of the Auth0 Single Page Application used by the front end and the Swagger UI (public, not a secret)."
  type        = string

  validation {
    condition     = var.auth0_spa_client_id != ""
    error_message = "auth0_spa_client_id is required."
  }
}

variable "auth0_claim_namespace" {
  description = "Namespace of the email claims added by the Auth0 post-login Action (AUTH0_CLAIM_NAMESPACE)."
  type        = string
  default     = "https://omnipotent/"
}

variable "super_admin_emails" {
  description = "Emails that become super-admins on their first verified sign-in (SUPER_ADMIN_EMAILS)."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------------------------------
# Backend settings
# ---------------------------------------------------------------------------------------------------

variable "node_env" {
  description = "What the backend runs as (NODE_ENV): prod, the opaque 5xx messages and the production configuration, or dev, for a disposable environment holding no real data (it is also what lets access_provider be the local implementation). Production is prod."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "dev"], var.node_env)
    error_message = "node_env is prod or dev."
  }
}

variable "access_provider" {
  description = "Where the identity and the roles of a caller come from (ACCESS_PROVIDER): omnipass, its client package, the only provider production accepts (D43). The local implementation grants every Organization to every caller and reads no membership, so the backend itself refuses to start with it under NODE_ENV=prod; this variable only keeps Terraform from configuring what would then crash-loop."
  type        = string
  default     = "omnipass"

  validation {
    condition     = contains(["omnipass", "local"], var.access_provider)
    error_message = "access_provider is omnipass or local."
  }

  validation {
    condition     = var.access_provider == "omnipass" || var.node_env != "prod"
    error_message = "access_provider = \"local\" needs node_env = \"dev\": production never serves real data with the local implementation of the rights (D43)."
  }
}

variable "omnipass_url" {
  description = "Base URL of omnipass, without a trailing slash (OMNIPASS_URL). omnipass is the single writer of the tenancy (T5), and this backend holds no table of its own for it (T4)."
  type        = string
  default     = "https://api.omnipass.app"

  validation {
    condition     = can(regex("^https://[^/]+$", var.omnipass_url)) || var.node_env != "prod"
    error_message = "omnipass_url is an https URL without a trailing slash in production."
  }
}

variable "omnipass_audience" {
  description = "Identifier of omnipass's REST API, which the machine token is issued for (OMNIPASS_AUDIENCE). Fixed by omnipass and the same in every environment."
  type        = string
  default     = "https://api.omnipass.app"
}

variable "omnipass_client_id" {
  description = "Client id of Omnipotent's machine account on omnipass (OMNIPASS_CLIENT_ID), a client_credentials application of the shared Auth0 tenant. Not a secret: its secret is written by hand into Secrets Manager under omnipass/client-secret."
  type        = string
  default     = ""

  validation {
    condition     = var.omnipass_client_id != "" || var.access_provider != "omnipass"
    error_message = "omnipass_client_id is required when access_provider = \"omnipass\": without a machine account the backend cannot resolve a single caller."
  }
}

variable "cors_origins" {
  description = "Origins of the web front ends allowed to call the API from a browser (APP_CORS_ORIGINS), and the URLs set on the Auth0 SPA application (output auth0_settings). Omnipotent serves no front of its own yet: after the switch it is multi-search's, e.g. [\"https://app.omnilor.com\"]. None by default: only server-to-server and MCP callers reach the API."
  type        = list(string)
  default     = []
  nullable    = false

  validation {
    condition     = alltrue([for origin in var.cors_origins : can(regex("^https?://[^/]+$", origin))])
    error_message = "each origin is a scheme and a host without a path, e.g. https://app.omnilor.com."
  }
}

variable "log_level" {
  description = "Log level of the API and the worker (APP_LOG_LEVEL): debug, info, warn or error. Info at launch, to follow the first days; warn once things are stable."
  type        = string
  default     = "info"

  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "log_level must be debug, info, warn or error."
  }
}

variable "docs_enabled" {
  description = "Serve the Swagger UI and the OpenAPI document on the API (/documentation, APP_DOCS_ENABLED). Off in production: the API's routes are not public knowledge; turn it on for a while to explore the API, with the Auth0 callback of infra/README.md (step 6)."
  type        = bool
  default     = false
}

variable "mcp_claude_client_id" {
  description = "Client id of the public (Native) Auth0 application Claude's custom connectors sign in with (MCP_CLAUDE_CLIENT_ID), shown on the « Assistant IA » page for the user to paste in the connector. Empty: the page tells it is not set up."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------------------------------
# Sizing
# ---------------------------------------------------------------------------------------------------

variable "image_tag" {
  description = "Image tag of the task definitions Terraform registers. The deploy workflow replaces it with the commit it deploys; set it to a deployed commit SHA only before a change that recreates a service."
  type        = string
  default     = "bootstrap"
}

variable "api_cpu" {
  description = "CPU units of an API task (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Memory of an API task, in MiB."
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "API tasks at creation (the autoscaling owns the count afterwards)."
  type        = number
  default     = 1
}

variable "api_min_count" {
  description = "Minimum number of API tasks."
  type        = number
  default     = 1
}

variable "api_max_count" {
  description = "Maximum number of API tasks."
  type        = number
  default     = 4
}

variable "api_cpu_target_percent" {
  description = "Average CPU the API autoscaling aims at."
  type        = number
  default     = 60
}

variable "worker_cpu" {
  description = "CPU units of the worker task."
  type        = number
  default     = 512
}

variable "worker_memory" {
  description = "Memory of the worker task, in MiB."
  type        = number
  default     = 1024
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.small"
}

variable "db_free_memory_alarm_bytes" {
  description = "Freeable database memory under which the db-free-memory alarm fires, in bytes (128 MB suits db.t4g.small's 2 GB)."
  type        = number
  default     = 134217728
}

variable "db_multi_az" {
  description = "Standby database in a second zone (doubles the database cost)."
  type        = bool
  default     = false
}

variable "db_allocated_storage" {
  description = "Initial database storage, in GB."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Database storage autoscaling ceiling, in GB."
  type        = number
  default     = 100
}

variable "db_backup_retention_days" {
  description = "Days of automated database backups (point-in-time recovery). Backups up to the size of the database are free."
  type        = number
  default     = 7

  validation {
    condition     = var.db_backup_retention_days >= 1 && var.db_backup_retention_days <= 35
    error_message = "db_backup_retention_days is between 1 and 35."
  }
}

variable "db_password_rotation_schedule" {
  description = "When RDS rotates the master password (without db_iam_auth, the services are redeployed right after)."
  type        = string
  default     = "cron(0 3 1 * ? *)"
}

variable "db_iam_auth" {
  description = "The API and the worker sign in to PostgreSQL as db_app_username with RDS IAM tokens of their task role (least privilege: rows of the application tables and the queue schema, no DDL on the tables, no password). false: they use the master user and its password again (rollback; see infra/README.md)."
  type        = bool
  default     = true
}

variable "db_apply_immediately" {
  description = "Apply the database changes of this apply now instead of in the maintenance window (turning IAM authentication on, for instance, must be effective before the deploy that switches the services to it)."
  type        = bool
  default     = false
}

variable "db_app_username" {
  description = "Database role of the API and the worker with db_iam_auth, created and granted by the migration task."
  type        = string
  default     = "omnipotent_app"

  validation {
    condition     = can(regex("^[a-z_][a-z0-9_]{0,62}$", var.db_app_username))
    error_message = "db_app_username is a plain PostgreSQL identifier (lower case letters, digits, underscores)."
  }
}

# ---------------------------------------------------------------------------------------------------
# Custom domain (DNS hosted elsewhere, records added by hand: infra/README.md, "Custom domain (Cloudflare)")
# ---------------------------------------------------------------------------------------------------

variable "domain_name" {
  description = "Domain whose subdomains serve the application, the API and the tracking scripts (e.g. omnilor.com). Its DNS zone stays where it is (Cloudflare): Terraform outputs the records to add by hand (dns_records). Setting it is stage 1: the certificates are requested, nothing else changes. Empty: no custom domain, everything on the default *.cloudfront.net addresses."
  type        = string
  default     = ""
  nullable    = false

  validation {
    condition     = var.domain_name == "" || can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$", var.domain_name))
    error_message = "domain_name is a bare lower-case domain such as omnilor.com (no scheme, no trailing dot), or empty."
  }
}

variable "domain_subdomains" {
  description = "Labels of the hostnames under domain_name: api (the API, MCP at /mcp). A phase serving public files to clients' sites or to a platform adds its own label here."
  type = object({
    api = optional(string, "api")
  })
  default  = {}
  nullable = false

  validation {
    condition = (
      alltrue([for label in values(var.domain_subdomains) : can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$", label))]) &&
      length(distinct(values(var.domain_subdomains))) == length(values(var.domain_subdomains))
    )
    error_message = "domain_subdomains holds different DNS labels (lower-case letters, digits, inner hyphens), e.g. api."
  }

  validation {
    condition     = length(setintersection(values(var.domain_subdomains), ["www", "mail"])) == 0
    error_message = "www stays the website's and mail the e-mails': choose other labels."
  }
}

variable "domain_certificates_validated" {
  description = "Stage 2 of the custom domain, once the three certificates are ISSUED (their validation records of dns_records added in Cloudflare): the hostnames and their certificates go on the distributions (TLS 1.2 minimum) and every public URL moves to them. Refused while a certificate is not ISSUED."
  type        = bool
  default     = false
  nullable    = false

  validation {
    condition     = !var.domain_certificates_validated || var.domain_name != ""
    error_message = "domain_certificates_validated = true needs domain_name, and stage 1 first (infra/README.md, \"Custom domain (Cloudflare)\")."
  }
}

# ---------------------------------------------------------------------------------------------------
# Network, edge, observability
# ---------------------------------------------------------------------------------------------------

variable "task_egress" {
  description = "How the ECS tasks reach the internet (Auth0, omnipass, the platforms, the AWS APIs). nat: from the private subnets through a NAT gateway, with a fixed egress IP (nat_egress_ips). public-ip: from the public subnets, each task with a public IP and no NAT gateway (about 30 USD a month less; the egress IP changes at every task start, and the tasks' security group alone keeps inbound traffic out: only the load balancer may connect). The load balancer and the database stay in the private subnets either way."
  type        = string
  default     = "nat"

  validation {
    condition     = contains(["nat", "public-ip"], var.task_egress)
    error_message = "task_egress is nat or public-ip."
  }
}

variable "nat_gateway_per_az" {
  description = "One NAT gateway per zone instead of a single one (more resilient, about 40 USD a month more each). Only with task_egress = nat."
  type        = bool
  default     = false

  validation {
    condition     = !var.nat_gateway_per_az || var.task_egress == "nat"
    error_message = "nat_gateway_per_az needs task_egress = nat."
  }
}

variable "enable_flow_logs" {
  description = "VPC flow logs (all traffic, default format, plain text) to the access logs bucket, under vpc-flow/ (kept access_logs_retention_days)."
  type        = bool
  default     = true
}

variable "alb_deregistration_delay" {
  description = "Seconds a stopping API task keeps serving its in-flight requests (matches the CloudFront origin read timeout)."
  type        = number
  default     = 60
}

variable "cloudfront_origin_read_timeout" {
  description = "Seconds CloudFront waits for the API (60 at most unless AWS raised the quota, up to 180)."
  type        = number
  default     = 60
}

variable "edge_access_logs_enabled" {
  description = "Access logs of the CloudFront distributions (standard logs) and of the load balancer, to the access logs bucket. The VPC flow logs (enable_flow_logs) do not depend on it."
  type        = bool
  default     = true
}

variable "access_logs_retention_days" {
  description = "Days the access logs of CloudFront and of the load balancer are kept (S3)."
  type        = number
  default     = 90
}

variable "waf_enabled" {
  description = "AWS WAF web ACL (us-east-1) in front of every distribution: per-IP rate limits and AWS managed rules (about 10 USD a month). The API keeps its own rate limits per user and per IP without it."
  type        = bool
  default     = true
}

variable "waf_rate_limit" {
  description = "Requests one client IP may send over waf_rate_limit_window, all routes of every distribution, before getting 429s."
  type        = number
  default     = 3000
}

variable "waf_public_rate_limit" {
  description = "Requests one client IP may send over waf_rate_limit_window to the anonymous routes (/t/, /feeds/, /email/unsubscribe, the probes, /status)."
  type        = number
  default     = 600
}

variable "waf_rate_limit_window" {
  description = "Evaluation window of the WAF rate limits, in seconds (60, 120, 300 or 600)."
  type        = number
  default     = 300
}

variable "waf_common_rules_count_only" {
  description = "Rules of the AWS managed common rule set only counted, not blocked (they would refuse legitimate API bodies)."
  type        = list(string)
  default     = ["SizeRestrictions_BODY", "SizeRestrictions_QUERYSTRING", "CrossSiteScripting_BODY"]
}

variable "waf_logging_enabled" {
  description = "Log the requests WAF blocks or counts to CloudWatch Logs in us-east-1 (paid ingestion; off by default)."
  type        = bool
  default     = false
}

variable "container_insights" {
  description = "ECS Container Insights: enabled, enhanced or disabled (disabled also removes the running-task alarms)."
  type        = string
  default     = "enabled"
}

variable "log_retention_days" {
  description = "Retention of the application logs, in days."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "E-mail address receiving the alarms (confirm the subscription e-mail AWS sends). Null: none."
  type        = string
  default     = null
}

variable "monthly_budget_usd" {
  description = "Monthly AWS budget of the account in USD (null: none)."
  type        = number
  default     = null
}

variable "create_audit_trail" {
  description = "Create a CloudTrail trail (audit; without db_iam_auth it also delivers the rotation events that redeploy the services). Set false only if the account already has a trail logging management events."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------------------------------
# Threat detection (phase 24)
# ---------------------------------------------------------------------------------------------------

variable "guardduty_enabled" {
  description = "Amazon GuardDuty in the region, its findings e-mailed through the alarm topic. false only if another stack of the account owns the region's detector."
  type        = bool
  default     = true
}

variable "guardduty_s3_protection" {
  description = "GuardDuty S3 Protection: analysis of the S3 data events of the account's buckets."
  type        = bool
  default     = true
}

variable "guardduty_rds_protection" {
  description = "GuardDuty RDS Protection (login activity of the PostgreSQL instance), $1 per vCPU and month."
  type        = bool
  default     = true
}

variable "guardduty_runtime_monitoring" {
  description = "GuardDuty Runtime Monitoring of the Fargate tasks (an agent sidecar in every task, up to 128 MB of its memory), $2.40 per vCPU and month in eu-north-1. Redeploy after switching it on."
  type        = bool
  default     = false
}

variable "guardduty_alert_min_severity" {
  description = "Lowest GuardDuty severity e-mailed: 4 = medium and above (low 1 to 3.9, medium 4 to 6.9, high 7 to 8.9, critical 9 to 10)."
  type        = number
  default     = 4
}

variable "guardduty_finding_publishing_frequency" {
  description = "How often the updates of a finding that keeps happening are published (and e-mailed): FIFTEEN_MINUTES, ONE_HOUR or SIX_HOURS."
  type        = string
  default     = "SIX_HOURS"
}

# ---------------------------------------------------------------------------------------------------
# Deployment
# ---------------------------------------------------------------------------------------------------

variable "github_deploy_role_enabled" {
  description = "The GitHub OIDC provider (create_github_oidc_provider) and the deploy role the deploy workflow assumes. false: neither, deploy with infra/scripts/deploy.sh and a local AWS profile."
  type        = bool
  default     = true
}

variable "ecr_repository_name" {
  description = "Name of the ECR repository of the backend image."
  type        = string
  default     = "omnipotent-backend"
}

variable "github_repository" {
  description = "GitHub repository (owner/name) allowed to deploy."
  type        = string
  default     = "MultiSearchAd/omnipotent"
}

variable "github_environment" {
  description = "GitHub environment the deploy jobs run in."
  type        = string
  default     = "production"
}

variable "github_branch" {
  description = "Branch allowed to deploy."
  type        = string
  default     = "main"
}

variable "github_oidc_subjects" {
  description = "Override of the OIDC subjects allowed to deploy (empty: repo:<repository>:environment:<environment>:ref:refs/heads/<branch>, which needs the custom subject template of infra/README.md)."
  type        = list(string)
  default     = []
}

variable "create_github_oidc_provider" {
  description = "Create the account's GitHub OIDC provider (false if another stack of the account already did)."
  type        = bool
  default     = true
}
