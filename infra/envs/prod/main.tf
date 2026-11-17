data "aws_caller_identity" "current" {}

locals {
  name       = "${var.project}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id

  # Secrets the backend reads and writes by name (SECRETS_PREFIX): omnipotent/prod/...
  secrets_prefix         = "${var.project}/${var.environment}"
  log_group_prefix       = "/ecs/${local.name}/"
  deploy_parameters_path = "/${var.project}/${var.environment}/deploy"

  # Custom domain (infra/README.md, "Custom domain (Cloudflare)"), in two stages because its DNS records are added by
  # hand: stage 1 (domain_name) only requests the certificates; stage 2 (domain_certificates_validated), once they are
  # issued, puts the hostnames on the distributions and moves every public URL below to them.
  domain_enabled   = var.domain_name != ""
  domain_ready     = local.domain_enabled && var.domain_certificates_validated
  domain_roles     = ["api"]
  domain_hostnames = { for role, label in var.domain_subdomains : role => "${label}.${var.domain_name}" if local.domain_enabled }

  # The public URLs, in HTTPS: the custom hostname in stage 2, the default CloudFront domain before.
  api_url = "https://${module.api_edge.hostname}"
  mcp_url = "${local.api_url}/mcp"

  # The records to add by hand in the DNS zone of domain_name (Cloudflare), as typed in its form: the name relative to
  # the zone, the target without its final dot, never proxied. The validation records come with stage 1 and stay for
  # good (ACM renews the certificates with them); the hostnames' come with stage 2.
  dns_records = concat(
    [
      for role in local.domain_roles : {
        purpose      = "Stage 1: validation of the certificate of ${local.domain_hostnames[role]}. Keep it: ACM renews the certificate with it."
        type         = "CNAME"
        name         = trimsuffix(trimsuffix(one(aws_acm_certificate.domain[role].domain_validation_options).resource_record_name, "."), ".${var.domain_name}")
        fqdn         = trimsuffix(one(aws_acm_certificate.domain[role].domain_validation_options).resource_record_name, ".")
        target       = trimsuffix(one(aws_acm_certificate.domain[role].domain_validation_options).resource_record_value, ".")
        proxy_status = "DNS only (grey cloud)"
      } if local.domain_enabled
    ],
    [
      for role in local.domain_roles : {
        purpose      = "Stage 2: ${local.domain_hostnames[role]} (${local.domain_purposes[role]})."
        type         = "CNAME"
        name         = var.domain_subdomains[role]
        fqdn         = local.domain_hostnames[role]
        target       = local.domain_targets[role]
        proxy_status = "DNS only (grey cloud)"
      } if local.domain_ready
    ],
  )
  domain_purposes = { api = "the API and MCP" }
  domain_targets  = { api = module.api_edge.domain_name }

  image = "${module.ecr.repository_url}:${var.image_tag}"

  # Where the ECS tasks run (task_egress): the private subnets behind the NAT gateway, or the public subnets with a public
  # IP each and no NAT gateway. The load balancer and the database stay in the private subnets either way.
  tasks_public_ip  = var.task_egress == "public-ip"
  tasks_subnet_ids = local.tasks_public_ip ? module.network.public_subnet_ids : module.network.private_subnet_ids

  # CloudFront and load balancer access logs (edge_access_logs_enabled), to the access logs bucket.
  edge_logs_bucket_domain_name = var.edge_access_logs_enabled ? module.access_logs.bucket_domain_name : null

  # Stopping an API task (deploy, scale-in): ECS first deregisters it from the target group and waits
  # for its in-flight requests (the deregistration delay, 60 s = the CloudFront origin read timeout, so
  # no accepted request is cut), THEN sends SIGTERM. By then no new request arrives: APP_DRAIN_DELAY only
  # keeps a short margin before the server closes, APP_SHUTDOWN_TIMEOUT bounds the whole shutdown, and
  # the stop timeout (SIGKILL) stays above it.
  api_drain_delay_ms      = 5000
  api_shutdown_timeout_ms = 20000
  api_stop_timeout        = 30

  # The worker has no load balancer (no drain); pg-boss lets running jobs finish for up to 30 s.
  worker_drain_delay_ms      = 0
  worker_shutdown_timeout_ms = 45000
  worker_stop_timeout        = 60

  # /livez, not /readyz: a database outage must not make ECS kill and restart the tasks in a loop. The image has
  # no curl (slim base): Node itself makes the request.
  health_check_command = [
    "CMD", "node", "-e",
    "fetch('http://127.0.0.1:3002/livez',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))",
  ]

  # The API and the worker sign in to PostgreSQL as this role with RDS IAM tokens (db_iam_auth); the migration
  # task, as the master user, creates it and grants it the rows of the application tables and the queue schema.
  app_db_user = var.db_iam_auth ? var.db_app_username : module.database.username

  # Environment of every process, checked against backend/config/custom-environment-variables.json.
  # The endpoints and static keys of S3 and Secrets Manager stay unset: node-config ignores an empty
  # environment variable, and config/prod.json (NODE_ENV=prod) already empties them (IAM role on AWS).
  common_environment = {
    NODE_ENV              = var.node_env
    APP_CORS_ORIGINS      = join(",", var.cors_origins)
    APP_LOG_LEVEL         = var.log_level
    APP_TELEMETRY_ENABLED = "false"
    MCP_RESOURCE_URL      = local.mcp_url
    MCP_CLAUDE_CLIENT_ID  = var.mcp_claude_client_id

    DB_HOST     = module.database.address
    DB_PORT     = tostring(module.database.port)
    DB_USER     = local.app_db_user
    DB_NAME     = module.database.db_name
    DB_SSL      = "true"
    DB_IAM_AUTH = tostring(var.db_iam_auth)
    DB_REGION   = var.region

    AUTH0_DOMAIN            = var.auth0_domain
    AUTH0_AUDIENCE          = var.auth0_audience
    AUTH0_SWAGGER_CLIENT_ID = var.auth0_spa_client_id

    # How to reach omnipass. The client secret is **not** here: the backend reads it from Secrets
    # Manager under OMNIPASS_SECRET_NAME, whose container is declared in `module "secrets"`.
    OMNIPASS_URL         = var.omnipass_url
    OMNIPASS_AUDIENCE    = var.omnipass_audience
    OMNIPASS_CLIENT_ID   = var.omnipass_client_id
    OMNIPASS_SECRET_NAME = "omnipass/client-secret"

    S3_REGION           = var.region
    S3_BUCKET           = module.storage.bucket_name
    S3_FORCE_PATH_STYLE = "false"
    S3_CREATE_BUCKET    = "false"

    SECRETS_REGION = var.region
    SECRETS_PREFIX = local.secrets_prefix
  }

  # Environment of the API tasks: the common one, plus what only the API uses.
  api_environment = merge(local.common_environment, {
    APP_MODE             = "api"
    APP_DRAIN_DELAY      = tostring(local.api_drain_delay_ms)
    APP_SHUTDOWN_TIMEOUT = tostring(local.api_shutdown_timeout_ms)

    # The Swagger UI and the OpenAPI document (/documentation): off in production (config/prod.json); docs_enabled
    # turns them back on. Set explicitly, so that the task definition shows it.
    APP_DOCS_ENABLED = tostring(var.docs_enabled)

    # The client address of the access log and the rate limits: the CloudFront-Viewer-Address header the API
    # distribution adds (the load balancer only accepts requests coming through CloudFront).
    TRUST_CLOUDFRONT_VIEWER_ADDRESS = "true"
  })

  # Read by the ECS agent at task start: the RDS-managed master password (key "password" of its JSON), for the
  # migration task, and the API and the worker without IAM authentication. A phase whose service needs a
  # credential at start adds it here, from module.secrets.arns.
  db_password_secret = { DB_PASSWORD = "${module.database.master_user_secret_arn}:password::" }
  app_secrets        = var.db_iam_auth ? {} : local.db_password_secret
}

# ---------------------------------------------------------------------------------------------------
# Foundations
# ---------------------------------------------------------------------------------------------------

module "network" {
  source = "../../modules/network"

  name                = local.name
  nat_gateway_enabled = var.task_egress == "nat"
  nat_gateway_per_az  = var.nat_gateway_per_az

  # All traffic, to the access logs bucket (vpc-flow/, kept access_logs_retention_days).
  enable_flow_logs          = var.enable_flow_logs
  flow_logs_destination_arn = module.access_logs.flow_logs_destination_arn
}

module "ecr" {
  source = "../../modules/ecr"

  name         = var.ecr_repository_name
  force_delete = var.force_destroy
}

# Secret containers, empty in the socle: each phase declares the credentials it needs here, and Terraform
# creates the container only — a value never goes through a variable or the state (infra/README.md).
module "secrets" {
  source = "../../modules/secrets"

  prefix = local.secrets_prefix
  secrets = {
    # The machine account Omnipotent calls omnipass with (T1). The container is created here; its
    # value is written by hand, never by Terraform, and nothing reads it back but the client itself.
    omnipass_client_secret = {
      name        = "omnipass/client-secret"
      description = "Client secret of Omnipotent's machine account on omnipass (client_credentials)"
    }
  }
  recovery_window_in_days = var.force_destroy ? 0 : 30
}

module "storage" {
  source = "../../modules/storage"

  bucket_name          = "${local.name}-assets-${local.account_id}"
  cors_allowed_origins = var.cors_origins
  force_destroy        = var.force_destroy
}

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"

  name               = local.name
  vpc_id             = module.network.vpc_id
  container_insights = var.container_insights
}

module "database" {
  source = "../../modules/database"

  iam_authentication = var.db_iam_auth
  apply_immediately  = var.db_apply_immediately

  identifier                 = local.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnet_ids
  client_security_group_ids  = [module.ecs_cluster.tasks_security_group_id]
  instance_class             = var.db_instance_class
  multi_az                   = var.db_multi_az
  allocated_storage          = var.db_allocated_storage
  max_allocated_storage      = var.db_max_allocated_storage
  log_retention_days         = var.log_retention_days
  password_rotation_schedule = var.db_password_rotation_schedule
  backup_retention_days      = var.db_backup_retention_days

  # A disposable environment (force_destroy): no deletion protection, no final snapshot, no backup kept.
  deletion_protection      = !var.force_destroy
  skip_final_snapshot      = var.force_destroy
  delete_automated_backups = var.force_destroy
}

module "audit_trail" {
  source = "../../modules/audit-trail"
  count  = var.create_audit_trail ? 1 : 0

  name          = local.name
  bucket_name   = "${local.name}-trail-${local.account_id}"
  force_destroy = var.force_destroy
}

# ---------------------------------------------------------------------------------------------------
# Edge: API load balancer behind CloudFront
# ---------------------------------------------------------------------------------------------------

# Access logs of the distributions and of the load balancer (edge_access_logs_enabled), and the VPC flow logs.
module "access_logs" {
  source = "../../modules/access-logs"

  bucket_name    = "${local.name}-access-logs-${local.account_id}"
  retention_days = var.access_logs_retention_days
  force_destroy  = var.force_destroy
}

# AWS WAF (scope CLOUDFRONT, hence us-east-1) in front of every distribution: per-IP rate limits and the AWS
# managed rules (waf_enabled).
module "waf" {
  source = "../../modules/waf"
  count  = var.waf_enabled ? 1 : 0
  providers = {
    aws = aws.us_east_1
  }

  name                    = local.name
  rate_limit              = var.waf_rate_limit
  public_rate_limit       = var.waf_public_rate_limit
  rate_limit_window       = var.waf_rate_limit_window
  common_rules_count_only = var.waf_common_rules_count_only
  logging_enabled         = var.waf_logging_enabled
  log_retention_days      = var.log_retention_days
}

module "alb" {
  source = "../../modules/alb"

  name                     = local.name
  vpc_id                   = module.network.vpc_id
  subnet_ids               = module.network.private_subnet_ids
  target_security_group_id = module.ecs_cluster.tasks_security_group_id
  target_port              = 3002
  deregistration_delay     = var.alb_deregistration_delay
  access_logs_bucket       = var.edge_access_logs_enabled ? module.access_logs.bucket_name : null
  access_logs_prefix       = module.access_logs.alb_prefix
}

# Custom domain, stage 1: one certificate per hostname, in us-east-1 (CloudFront's region), validated by DNS. Their
# validation records go in the zone by hand (output dns_records); ACM issues them a few minutes after.
resource "aws_acm_certificate" "domain" {
  provider = aws.us_east_1
  for_each = local.domain_hostnames

  domain_name       = each.value
  validation_method = "DNS"

  tags = { Name = "${local.name}-${each.key}" }

  # A new hostname: the new certificate is attached before the old one goes.
  lifecycle {
    create_before_destroy = true
  }
}

# Stage 2: refused while a certificate is not ISSUED, so the distributions never get a certificate CloudFront would
# reject, and nothing waits for a record that is not there. The wait itself is then only a safeguard.
resource "aws_acm_certificate_validation" "domain" {
  provider = aws.us_east_1
  for_each = { for role, hostname in local.domain_hostnames : role => hostname if local.domain_ready }

  certificate_arn = aws_acm_certificate.domain[each.key].arn

  timeouts {
    create = "15m"
  }

  lifecycle {
    precondition {
      condition = aws_acm_certificate.domain[each.key].status == "ISSUED"
      error_message = join(" ", [
        "The certificate of ${each.value} is ${aws_acm_certificate.domain[each.key].status}, not ISSUED: nothing changes on the distributions until it is.",
        lookup({
          PENDING_VALIDATION   = "Its validation record is missing or wrong in Cloudflare, or ACM has not seen it yet (a few minutes). The record: type CNAME, name ${trimsuffix(trimsuffix(one(aws_acm_certificate.domain[each.key].domain_validation_options).resource_record_name, "."), ".${var.domain_name}")}, target ${trimsuffix(one(aws_acm_certificate.domain[each.key].domain_validation_options).resource_record_value, ".")}, proxy status DNS only (grey cloud)."
          FAILED               = "ACM refused it, often because of a CAA record of the zone that does not allow amazon.com (aws acm describe-certificate --region us-east-1 gives the reason). Fix it, then request it again: terraform apply -replace='aws_acm_certificate.domain[\"${each.key}\"]'."
          VALIDATION_TIMED_OUT = "72 hours went by without its validation record: request it again, terraform apply -replace='aws_acm_certificate.domain[\"${each.key}\"]'."
        }, aws_acm_certificate.domain[each.key].status, ""),
        "Apply again once `aws acm list-certificates --region us-east-1` shows it ISSUED (infra/README.md, \"Custom domain (Cloudflare)\").",
      ])
    }
  }
}

module "api_edge" {
  source = "../../modules/api-edge"

  name                    = local.name
  alb_dns_name            = module.alb.dns_name
  alb_arn                 = module.alb.arn
  origin_header_name      = module.alb.origin_header_name
  origin_header_value     = module.alb.origin_header_value
  origin_read_timeout     = var.cloudfront_origin_read_timeout
  web_acl_arn             = one(module.waf[*].web_acl_arn)
  logs_bucket_domain_name = local.edge_logs_bucket_domain_name
  logs_prefix             = module.access_logs.cloudfront_prefixes["api"]

  # Custom domain, stage 2: api.<domain>. The second distribution of the module, for a host serving public
  # files only (s.<domain>), stays off until the phase that serves them passes its alias.
  alias                = local.domain_ready ? local.domain_hostnames["api"] : null
  certificate_arn      = local.domain_ready ? aws_acm_certificate_validation.domain["api"].certificate_arn : null
  tracking_logs_prefix = module.access_logs.cloudfront_prefixes["tracking"]
}

# ---------------------------------------------------------------------------------------------------
# Application: one image, three task definitions (API, worker, migrations)
# ---------------------------------------------------------------------------------------------------

module "task_roles" {
  source = "../../modules/task-roles"

  name                 = local.name
  ecr_repository_arn   = module.ecr.repository_arn
  log_group_prefix     = local.log_group_prefix
  injected_secret_arns = [module.database.master_user_secret_arn]
  assets_bucket_arn    = module.storage.bucket_arn
  secrets_prefix       = local.secrets_prefix

  # Each phase lists here the containers of module.secrets its service reads, and those the backend writes
  # back (OAuth tokens at a refresh, a signing key).
  read_only_secret_arns   = []
  app_written_secret_arns = []
  db_connect_arns = var.db_iam_auth ? [
    "arn:aws:rds-db:${var.region}:${local.account_id}:dbuser:${module.database.resource_id}/${var.db_app_username}",
  ] : []

  # GuardDuty's agent, a sidecar of every task with Runtime Monitoring (guardduty_runtime_monitoring).
  sidecar_repository_arns = flatten(module.guardduty[*].fargate_agent_repository_arns)
}

module "api" {
  source = "../../modules/ecs-service"

  name               = "api"
  family             = "${local.name}-api"
  cluster_arn        = module.ecs_cluster.cluster_arn
  image              = local.image
  cpu                = var.api_cpu
  memory             = var.api_memory
  container_port     = 3002
  task_role_arn      = module.task_roles.task_role_arn
  execution_role_arn = module.task_roles.execution_role_arn
  log_group_name     = "${local.log_group_prefix}api"
  log_retention_days = var.log_retention_days

  environment = local.api_environment
  secrets     = local.app_secrets

  health_check_command = local.health_check_command
  stop_timeout         = local.api_stop_timeout

  subnet_ids                        = local.tasks_subnet_ids
  assign_public_ip                  = local.tasks_public_ip
  security_group_ids                = [module.ecs_cluster.tasks_security_group_id]
  desired_count                     = var.api_desired_count
  target_group_arn                  = module.alb.target_group_arn
  health_check_grace_period_seconds = 60

  autoscaling = {
    min_count          = var.api_min_count
    max_count          = var.api_max_count
    cpu_target_percent = var.api_cpu_target_percent
  }
}

module "worker" {
  source = "../../modules/ecs-service"

  name               = "worker"
  family             = "${local.name}-worker"
  cluster_arn        = module.ecs_cluster.cluster_arn
  image              = local.image
  cpu                = var.worker_cpu
  memory             = var.worker_memory
  task_role_arn      = module.task_roles.task_role_arn
  execution_role_arn = module.task_roles.execution_role_arn
  log_group_name     = "${local.log_group_prefix}worker"
  log_retention_days = var.log_retention_days

  environment = merge(local.common_environment, {
    APP_MODE             = "worker"
    APP_DRAIN_DELAY      = tostring(local.worker_drain_delay_ms)
    APP_SHUTDOWN_TIMEOUT = tostring(local.worker_shutdown_timeout_ms)
  })
  secrets = local.app_secrets

  health_check_command = local.health_check_command
  stop_timeout         = local.worker_stop_timeout

  subnet_ids         = local.tasks_subnet_ids
  assign_public_ip   = local.tasks_public_ip
  security_group_ids = [module.ecs_cluster.tasks_security_group_id]
  desired_count      = 1
}

# Run by the deploy workflow before the services are updated (aws ecs run-task), never as a service.
module "migrate" {
  source = "../../modules/ecs-service"

  name               = "migrate"
  family             = "${local.name}-migrate"
  create_service     = false
  cluster_arn        = module.ecs_cluster.cluster_arn
  image              = local.image
  command            = ["node", "dist/database/migrate.js"]
  cpu                = 256
  memory             = 512
  task_role_arn      = module.task_roles.migrate_task_role_arn
  execution_role_arn = module.task_roles.execution_role_arn
  log_group_name     = "${local.log_group_prefix}migrate"
  log_retention_days = var.log_retention_days

  # The master user, with its password; after the migrations it creates or updates the application role
  # (DB_APP_USER) the API and the worker sign in as.
  environment = merge(local.common_environment, {
    APP_LOG_LEVEL = "info"
    DB_USER       = module.database.username
    DB_IAM_AUTH   = "false"
    DB_APP_USER   = var.db_iam_auth ? var.db_app_username : ""
  })
  secrets = local.db_password_secret
}

# Only without IAM authentication: the API and the worker then hold the master password, read at start.
module "db_rotation_restart" {
  source = "../../modules/db-rotation-restart"
  count  = var.db_iam_auth ? 0 : 1

  name        = local.name
  secret_arn  = module.database.master_user_secret_arn
  cluster_arn = module.ecs_cluster.cluster_arn
  services = {
    api    = module.api.service_arn
    worker = module.worker.service_arn
  }
  alarm_topic_arn = module.monitoring.alarm_topic_arn
}

# ---------------------------------------------------------------------------------------------------
# Monitoring
# ---------------------------------------------------------------------------------------------------

module "monitoring" {
  source = "../../modules/monitoring"

  name                           = local.name
  alarm_email                    = var.alarm_email
  alb_arn_suffix                 = module.alb.arn_suffix
  target_group_arn_suffix        = module.alb.target_group_arn_suffix
  cluster_name                   = module.ecs_cluster.cluster_name
  service_names                  = ["api", "worker"]
  container_insights_enabled     = var.container_insights != "disabled"
  db_instance_identifier         = module.database.identifier
  db_free_memory_threshold_bytes = var.db_free_memory_alarm_bytes
  monthly_budget_usd             = var.monthly_budget_usd
}

# Threat detection: GuardDuty in the region, its findings of medium severity and above e-mailed through the alarm topic.
module "guardduty" {
  source = "../../modules/guardduty"
  count  = var.guardduty_enabled ? 1 : 0

  name                         = local.name
  alarm_topic_arn              = module.monitoring.alarm_topic_arn
  s3_protection                = var.guardduty_s3_protection
  rds_protection               = var.guardduty_rds_protection
  runtime_monitoring           = var.guardduty_runtime_monitoring
  finding_publishing_frequency = var.guardduty_finding_publishing_frequency
  alert_min_severity           = var.guardduty_alert_min_severity
}

# ---------------------------------------------------------------------------------------------------
# Deployment: GitHub Actions role and the parameters the workflow (or infra/scripts/deploy.sh) reads
# ---------------------------------------------------------------------------------------------------

# Without it (github_deploy_role_enabled = false), deploy with infra/scripts/deploy.sh and a local AWS profile.
module "github_oidc" {
  source = "../../modules/github-oidc"
  count  = var.github_deploy_role_enabled ? 1 : 0

  name            = local.name
  create_provider = var.create_github_oidc_provider
  # The repository's OIDC subject template includes the environment AND the ref (infra/README.md): only
  # a job of the production environment running on main can deploy.
  subjects = length(var.github_oidc_subjects) > 0 ? var.github_oidc_subjects : [
    "repo:${var.github_repository}:environment:${var.github_environment}:ref:refs/heads/${var.github_branch}",
  ]

  ecr_repository_arn      = module.ecr.repository_arn
  cluster_arn             = module.ecs_cluster.cluster_arn
  service_arns            = [module.api.service_arn, module.worker.service_arn]
  migration_task_family   = module.migrate.task_family
  migration_log_group_arn = module.migrate.log_group_arn
  passable_role_arns = [
    module.task_roles.task_role_arn,
    module.task_roles.migrate_task_role_arn,
    module.task_roles.execution_role_arn,
  ]
  deploy_parameters_path = local.deploy_parameters_path
}

module "deploy_parameters" {
  source = "../../modules/deploy-parameters"

  path       = local.deploy_parameters_path
  parameters = local.deploy_parameters
}

locals {
  # Read by .github/workflows/deploy.yml and infra/scripts/deploy.sh (migrate-assign-public-ip: ENABLED when the
  # tasks run in the public subnets, task_egress = public-ip).
  deploy_parameters = {
    region                   = var.region
    ecr-repository-name      = module.ecr.repository_name
    ecr-repository-url       = module.ecr.repository_url
    cluster                  = module.ecs_cluster.cluster_name
    api-service              = module.api.service_name
    worker-service           = module.worker.service_name
    api-task-family          = module.api.task_family
    worker-task-family       = module.worker.task_family
    migrate-task-family      = module.migrate.task_family
    container-name           = module.api.container_name
    migrate-log-group        = module.migrate.log_group_name
    migrate-subnets          = join(",", local.tasks_subnet_ids)
    migrate-assign-public-ip = local.tasks_public_ip ? "ENABLED" : "DISABLED"
    migrate-security-group   = module.ecs_cluster.tasks_security_group_id
    api-url                  = local.api_url
    mcp-url                  = local.mcp_url
    auth0-domain             = var.auth0_domain
    auth0-spa-client-id      = var.auth0_spa_client_id
    auth0-audience           = var.auth0_audience
  }
}

# The WAF and the GitHub deploy role became optional (count): their resources keep their state.
moved {
  from = module.waf
  to   = module.waf[0]
}

moved {
  from = module.github_oidc
  to   = module.github_oidc[0]
}
