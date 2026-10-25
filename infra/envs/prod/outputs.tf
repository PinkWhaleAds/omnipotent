output "api_url" {
  description = "URL of the API (with docs_enabled, the Swagger UI is at <api_url>/documentation)."
  value       = local.api_url
}

output "mcp_url" {
  description = "URL of the MCP endpoint (= the identifier of the Auth0 MCP API)."
  value       = local.mcp_url
}

output "dns_records" {
  description = "Records to add by hand in the DNS zone of domain_name (Cloudflare: DNS > Records > Add record), all CNAME and DNS only (grey cloud): stage 1, the certificates' validation (kept for good); stage 2, the hostnames too. Empty without a custom domain."
  value       = local.dns_records
}

output "custom_domain_next_step" {
  description = "Where the custom domain stands and what to do next (infra/README.md, \"Custom domain (Cloudflare)\")."
  value = (
    !local.domain_enabled ? "No custom domain (domain_name is empty): everything is on the default *.cloudfront.net addresses." :
    !local.domain_ready ? "Stage 1: add the ${length(local.dns_records)} records of dns_records in Cloudflare (CNAME, DNS only). Once `aws acm list-certificates --region us-east-1` shows the certificates ISSUED, set domain_certificates_validated = true and apply." :
    "Stage 2: in Cloudflare, keep the validation records and add the hostname records of dns_records (CNAME, DNS only). Check them with dig, update Auth0 (auth0_settings), then run the deploy workflow."
  )
}

output "nat_egress_ips" {
  description = "Fixed public IPs the backend calls out from (platform allow lists, SFTP). Empty with task_egress = public-ip: each task then calls out from its own public IP, which changes at every start."
  value       = module.network.nat_public_ips
}

output "secrets_to_fill" {
  description = "Secrets created empty: put their values with `aws secretsmanager put-secret-value` (infra/README.md). Empty in the socle, since no phase has declared a credential yet."
  value       = module.secrets.names
}

output "deploy_role_arn" {
  description = "GitHub variable AWS_DEPLOY_ROLE_ARN of the production environment (null without github_deploy_role_enabled: deploy with infra/scripts/deploy.sh)."
  value       = one(module.github_oidc[*].deploy_role_arn)
}

output "github_settings" {
  description = "What to set in GitHub (Settings > Environments > production); null without github_deploy_role_enabled."
  value = var.github_deploy_role_enabled ? {
    environment                  = var.github_environment
    deployment_branch            = var.github_branch
    variable_AWS_DEPLOY_ROLE_ARN = one(module.github_oidc[*].deploy_role_arn)
    variable_AWS_REGION          = var.region
    oidc_subject_claim_keys      = ["repo", "context", "ref"]
  } : null
}

output "auth0_settings" {
  description = "What to enter in Auth0 for this environment."
  value = {
    # The web front ends allowed to call the API (cors_origins; multi-search's until Omnipotent has its own),
    # plus the Swagger UI's redirect while it is served (docs_enabled).
    spa_allowed_callback_urls = concat(var.cors_origins, var.docs_enabled ? ["${local.api_url}/documentation/static/oauth2-redirect.html"] : [])
    spa_allowed_logout_urls   = var.cors_origins
    spa_allowed_web_origins   = var.cors_origins
    rest_api_identifier       = var.auth0_audience
    mcp_api_identifier        = local.mcp_url
  }
}

output "deploy_parameters_path" {
  description = "SSM path of the parameters the deploy workflow and infra/scripts/deploy.sh read."
  value       = module.deploy_parameters.path
}

output "ecr_repository_url" {
  description = "Repository of the backend image."
  value       = module.ecr.repository_url
}

output "database_endpoint" {
  description = "Host of the PostgreSQL instance (private; TLS required)."
  value       = module.database.address
}

output "database_secret_arn" {
  description = "Secret holding the database credentials, managed and rotated by RDS."
  value       = module.database.master_user_secret_arn
}

output "alarm_topic_arn" {
  description = "SNS topic of the alarms."
  value       = module.monitoring.alarm_topic_arn
}

output "access_logs_bucket" {
  description = "Bucket of the access logs: cloudfront/api/ and cloudfront/tracking/ (CloudFront standard logs) and alb/ (load balancer) with edge_access_logs_enabled, vpc-flow/ (VPC flow logs) with enable_flow_logs."
  value       = module.access_logs.bucket_name
}

output "waf_web_acl" {
  description = "Name of the WAF web ACL of the distributions (console: WAF & Shield, region Global / us-east-1); null without waf_enabled."
  value       = one(module.waf[*].web_acl_name)
}

output "database_app_user" {
  description = "Database role of the API and the worker (DB_USER): the IAM-authenticated application role, or the master user without db_iam_auth."
  value       = local.app_db_user
}

output "guardduty_detector_id" {
  description = "GuardDuty detector of the region (null without guardduty_enabled), for aws guardduty commands."
  value       = one(module.guardduty[*].detector_id)
}
