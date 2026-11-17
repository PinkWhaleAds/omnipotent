# Offline test of the production stack: `terraform test` plans (and applies) the whole configuration
# against MOCKED providers, without any AWS account or call. It catches what `terraform validate` cannot:
# a count or for_each that depends on a value only known after apply, an index on an empty list, a wrong
# reference between modules. The mock values only need the right shape (an ARN where one is expected).
#
#   terraform init -backend=false && terraform test

mock_provider "aws" {
  source = "./tests/mocks/aws"
}

# The provider of the CloudFront-scoped resources (WAF web ACL, certificates of the custom domain), in us-east-1.
mock_provider "aws" {
  alias  = "us_east_1"
  source = "./tests/mocks/aws-us-east-1"
}

mock_provider "random" {}

variables {
  auth0_domain        = "tenant.eu.auth0.com"
  auth0_audience      = "https://api.omnipotent.app"
  auth0_spa_client_id = "spa-client-id"
  super_admin_emails  = ["admin@example.com"]
  alarm_email         = "ops@example.com"
  monthly_budget_usd  = 200
  # Production resolves its callers through omnipass (D43), which needs a machine account: the
  # variable has no default, so every plan names one.
  omnipass_client_id = "omnipass-machine-client-id"
}

run "plan_with_defaults" {
  command = plan
}

run "plan_with_every_option_switched" {
  command = plan

  variables {
    nat_gateway_per_az          = true
    enable_flow_logs            = false
    guardduty_enabled           = false
    docs_enabled                = true
    container_insights          = "disabled"
    create_audit_trail          = false
    create_github_oidc_provider = false
    alarm_email                 = null
    monthly_budget_usd          = null
    github_oidc_subjects        = ["repo:PinkWhaleAds/omnipotent:ref:refs/heads/main"]
    github_deploy_role_enabled  = false
    waf_enabled                 = false
    edge_access_logs_enabled    = false
    db_backup_retention_days    = 1
    allowed_account_ids         = ["123456789012"]
  }
}

run "apply_with_defaults" {
  command = apply

  assert {
    condition     = local.common_environment["MCP_RESOURCE_URL"] == "https://d123.cloudfront.net/mcp"
    error_message = "MCP_RESOURCE_URL must be the MCP URL of the API distribution."
  }

  assert {
    condition     = local.common_environment["APP_CORS_ORIGINS"] == "" && local.common_environment["DB_SSL"] == "true"
    error_message = "No front end is allowed by default (cors_origins is empty), and TLS is on."
  }

  assert {
    condition     = local.common_environment["ACCESS_PROVIDER"] == "omnipass"
    error_message = "Production reads the identity and the roles from omnipass (D43): the API refuses to start otherwise."
  }

  assert {
    condition     = local.common_environment["SUPER_ADMIN_EMAILS"] == "[\"admin@example.com\"]"
    error_message = "SUPER_ADMIN_EMAILS must be a JSON array."
  }

  assert {
    condition     = local.db_password_secret["DB_PASSWORD"] == "arn:aws:secretsmanager:eu-north-1:123456789012:secret:rds!db-1-AbCdEf:password::"
    error_message = "DB_PASSWORD must read the password key of the RDS-managed secret."
  }

  assert {
    condition = (
      local.common_environment["DB_USER"] == "omnipotent_app" &&
      local.common_environment["DB_IAM_AUTH"] == "true" &&
      local.common_environment["DB_REGION"] == "eu-north-1" &&
      !contains(keys(local.app_secrets), "DB_PASSWORD") &&
      output.database_app_user == "omnipotent_app"
    )
    error_message = "The API and the worker sign in as the application role with IAM tokens, without the master password."
  }

  assert {
    condition     = length(module.db_rotation_restart) == 0
    error_message = "With IAM authentication, a rotation of the master password does not redeploy the services."
  }

  assert {
    condition     = output.waf_web_acl == "omnipotent-prod" && output.access_logs_bucket != ""
    error_message = "The web ACL and the access logs bucket exist."
  }

  assert {
    condition     = local.health_check_command[0] == "CMD" && local.health_check_command[1] == "node"
    error_message = "The health check runs node (the slim image has no curl)."
  }

  assert {
    condition     = output.github_settings.variable_AWS_REGION == "eu-north-1" && output.auth0_settings.mcp_api_identifier == output.mcp_url
    error_message = "Outputs for GitHub and Auth0."
  }

  assert {
    condition = (
      local.api_environment["APP_DOCS_ENABLED"] == "false" &&
      !contains(keys(local.common_environment), "APP_DOCS_ENABLED") &&
      length(output.auth0_settings.spa_allowed_callback_urls) == 0
    )
    error_message = "The API serves no Swagger UI by default (APP_DOCS_ENABLED=false), and Auth0 needs no Swagger callback."
  }

  assert {
    condition = (
      local.api_environment["APP_MODE"] == "api" &&
      local.api_environment["TRUST_CLOUDFRONT_VIEWER_ADDRESS"] == "true" &&
      local.api_environment["MCP_RESOURCE_URL"] == local.common_environment["MCP_RESOURCE_URL"]
    )
    error_message = "The API environment is the common one plus the API's own settings."
  }

  assert {
    condition     = length(module.guardduty) == 1 && output.guardduty_detector_id != null
    error_message = "GuardDuty is on by default."
  }

  assert {
    condition = (
      length(module.github_oidc) == 1 && output.deploy_role_arn != null &&
      length(module.waf) == 1 &&
      length(module.audit_trail) == 1 &&
      local.edge_logs_bucket_domain_name != null &&
      !var.force_destroy && length(var.allowed_account_ids) == 0
    )
    error_message = "Production keeps its GitHub deploy role, its WAF, its trail, its access logs and its protections by default."
  }

  assert {
    condition = (
      !local.tasks_public_ip &&
      local.tasks_subnet_ids == module.network.private_subnet_ids &&
      length(output.nat_egress_ips) == 1 &&
      local.deploy_parameters["migrate-subnets"] == join(",", module.network.private_subnet_ids) &&
      local.deploy_parameters["migrate-assign-public-ip"] == "DISABLED"
    )
    error_message = "Production's tasks run in the private subnets behind the NAT gateway, without public IP."
  }

  assert {
    condition = (
      local.common_environment["SECRETS_PREFIX"] == "omnipotent/prod" &&
      output.secrets_to_fill == { omnipass_client_secret = "omnipotent/prod/omnipass/client-secret" } &&
      length(local.app_secrets) == 0 &&
      local.common_environment["OMNIPASS_SECRET_NAME"] == "omnipass/client-secret"
    )
    error_message = "One container to fill by hand, the machine account on omnipass, and nothing injected into the tasks: the backend reads its value through the SDK, never through an environment variable."
  }

  assert {
    condition = (
      length(aws_acm_certificate.domain) == 0 &&
      length(aws_acm_certificate_validation.domain) == 0 &&
      module.api_edge.tracking_domain_name == null &&
      module.api_edge.hostname == "d123.cloudfront.net" &&
      length(output.dns_records) == 0 &&
      startswith(output.custom_domain_next_step, "No custom domain")
    )
    error_message = "Without domain_name: no certificate, no second distribution, no DNS record, the default CloudFront domain."
  }
}

run "apply_with_docs_and_runtime_monitoring" {
  command = apply

  variables {
    docs_enabled                 = true
    guardduty_runtime_monitoring = true
  }

  assert {
    condition = (
      local.api_environment["APP_DOCS_ENABLED"] == "true" &&
      contains(output.auth0_settings.spa_allowed_callback_urls, "https://d123.cloudfront.net/documentation/static/oauth2-redirect.html")
    )
    error_message = "docs_enabled serves the Swagger UI and lists its Auth0 callback."
  }
}

run "refuse_force_destroy_in_prod" {
  command = plan

  variables {
    force_destroy = true
  }

  expect_failures = [var.force_destroy]
}

run "plan_without_iam_auth" {
  command = plan

  variables {
    db_iam_auth = false
  }

  assert {
    condition = (
      local.common_environment["DB_USER"] == "omnipotent" &&
      local.common_environment["DB_IAM_AUTH"] == "false" &&
      contains(keys(local.app_secrets), "DB_PASSWORD") &&
      length(module.db_rotation_restart) == 1
    )
    error_message = "Without IAM authentication, the services use the master user, its password, and are redeployed after a rotation."
  }
}

run "refuse_an_app_user_that_is_no_identifier" {
  command = plan

  variables {
    db_app_username = "omnipotent app"
  }

  expect_failures = [var.db_app_username]
}

# ---------------------------------------------------------------------------------------------------
# Custom domain: stage 1, then stage 2 on the state stage 1 left (as for real)
# ---------------------------------------------------------------------------------------------------

run "domain_stage_1_requests_the_certificates_only" {
  command = apply

  variables {
    domain_name = "pinkwhale.co"
  }

  assert {
    condition = (
      toset([for certificate in aws_acm_certificate.domain : certificate.domain_name]) == toset(["omnipotent.pinkwhale.co"]) &&
      alltrue([for certificate in aws_acm_certificate.domain : certificate.validation_method == "DNS"]) &&
      length(aws_acm_certificate_validation.domain) == 0
    )
    error_message = "Stage 1 requests a DNS-validated certificate for omnipotent., and waits for none."
  }

  assert {
    condition = (
      output.api_url == "https://d123.cloudfront.net" &&
      output.mcp_url == "https://d123.cloudfront.net/mcp" &&
      module.api_edge.tracking_domain_name == null
    )
    error_message = "Stage 1 changes no URL and no distribution."
  }

  assert {
    condition = (
      length(output.dns_records) == 1 &&
      alltrue([for record in output.dns_records : (
        startswith(record.purpose, "Stage 1: validation") &&
        record.type == "CNAME" &&
        record.proxy_status == "DNS only (grey cloud)"
      )])
    )
    error_message = "Stage 1 lists the validation record: CNAME, DNS only."
  }

  assert {
    condition = (
      output.dns_records[0].name == "_0a1b2c3d4e5f.omnipotent" &&
      output.dns_records[0].fqdn == "_0a1b2c3d4e5f.omnipotent.pinkwhale.co" &&
      output.dns_records[0].target == "_9f8e7d6c5b4a.xlfgrmvvlj.acm-validations.aws"
    )
    error_message = "A record is given as Cloudflare's form takes it: the name relative to the zone, no final dot."
  }

  assert {
    condition     = startswith(output.custom_domain_next_step, "Stage 1")
    error_message = "The next step is to add the validation records."
  }
}

run "domain_stage_2_moves_every_url" {
  command = apply

  variables {
    domain_name                   = "pinkwhale.co"
    domain_certificates_validated = true
  }

  assert {
    condition = (
      toset(keys(aws_acm_certificate_validation.domain)) == toset(["api"]) &&
      module.api_edge.hostname == "omnipotent.pinkwhale.co" &&
      module.api_edge.tracking_hostname == null
    )
    error_message = "Stage 2 waits for the certificate and serves omnipotent."
  }

  assert {
    condition = (
      output.api_url == "https://omnipotent.pinkwhale.co" &&
      output.mcp_url == "https://omnipotent.pinkwhale.co/mcp"
    )
    error_message = "Stage 2 moves the URLs to the custom hostname."
  }

  assert {
    condition = (
      local.common_environment["MCP_RESOURCE_URL"] == "https://omnipotent.pinkwhale.co/mcp" &&
      local.api_environment["MCP_RESOURCE_URL"] == "https://omnipotent.pinkwhale.co/mcp"
    )
    error_message = "The backend builds its public URLs from the custom hostname: the MCP resource is the API's."
  }

  assert {
    condition = (
      length(output.auth0_settings.spa_allowed_callback_urls) == 0 &&
      output.auth0_settings.mcp_api_identifier == "https://omnipotent.pinkwhale.co/mcp" &&
      output.auth0_settings.rest_api_identifier == "https://api.omnipotent.app"
    )
    error_message = "Auth0: the MCP API's identifier follows the API's hostname, the REST API's is unchanged."
  }

  assert {
    condition = (
      length(output.dns_records) == 2 &&
      [for record in slice(output.dns_records, 1, 2) : "${record.name} ${record.type} ${record.target}"] == ["omnipotent CNAME d123.cloudfront.net"] &&
      [for record in slice(output.dns_records, 1, 2) : record.fqdn] == ["omnipotent.pinkwhale.co"] &&
      alltrue([for record in output.dns_records : record.proxy_status == "DNS only (grey cloud)"]) &&
      length([for record in output.dns_records : record if startswith(record.purpose, "Stage 1")]) == 1
    )
    error_message = "Stage 2 keeps the validation record and adds a CNAME per hostname to its distribution, DNS only."
  }

  assert {
    condition     = startswith(output.custom_domain_next_step, "Stage 2")
    error_message = "The next step is to add the hostnames' records."
  }
}

# Set at once with domain_name, or before ACM issued the certificates: refused, and the error gives the record.
run "domain_stage_2_refuses_a_certificate_not_issued" {
  command   = plan
  state_key = "certificate_pending"

  variables {
    domain_name                   = "pinkwhale.co"
    domain_certificates_validated = true
  }

  override_resource {
    target          = aws_acm_certificate.domain
    override_during = plan
    values = {
      arn    = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
      status = "PENDING_VALIDATION"
      domain_validation_options = [{
        domain_name           = "ms.pinkwhale.co"
        resource_record_name  = "_0a1b2c3d4e5f.ms.pinkwhale.co."
        resource_record_type  = "CNAME"
        resource_record_value = "_9f8e7d6c5b4a.xlfgrmvvlj.acm-validations.aws."
      }]
    }
  }

  expect_failures = [aws_acm_certificate_validation.domain]
}

run "refuse_validated_certificates_without_a_domain" {
  command = plan

  variables {
    domain_certificates_validated = true
  }

  expect_failures = [var.domain_certificates_validated]
}

run "refuse_a_domain_that_is_a_url" {
  command = plan

  variables {
    domain_name = "https://pinkwhale.co/"
  }

  expect_failures = [var.domain_name]
}

run "refuse_the_label_of_the_website" {
  command = plan

  variables {
    domain_name       = "pinkwhale.co"
    domain_subdomains = { api = "www" }
  }

  expect_failures = [var.domain_subdomains]
}

# ---------------------------------------------------------------------------------------------------
# Modules on their own (their resources are only visible to assertions this way)
# ---------------------------------------------------------------------------------------------------

run "waf_rules" {
  command = plan

  module {
    source = "../../modules/waf"
  }

  variables {
    name = "omnipotent-prod"
  }

  assert {
    condition     = aws_wafv2_web_acl.this.scope == "CLOUDFRONT" && length(aws_wafv2_web_acl.this.default_action[0].allow) == 1
    error_message = "A CloudFront web ACL that allows what no rule blocks."
  }

  assert {
    condition = (
      [for rule in aws_wafv2_web_acl.this.rule : rule.name] == ["public-rate-per-ip", "rate-per-ip", "known-bad-inputs", "common"] ||
      toset([for rule in aws_wafv2_web_acl.this.rule : "${rule.priority}:${rule.name}"]) == toset(["0:public-rate-per-ip", "1:rate-per-ip", "2:known-bad-inputs", "3:common"])
    )
    error_message = "Rules: public rate limit, global rate limit, known bad inputs, common rule set, in that order."
  }

  assert {
    condition = alltrue([
      for rule in aws_wafv2_web_acl.this.rule : rule.visibility_config[0].cloudwatch_metrics_enabled && rule.visibility_config[0].sampled_requests_enabled
    ])
    error_message = "Every rule has its metrics and sampled requests."
  }

  assert {
    condition = alltrue([
      for rule in aws_wafv2_web_acl.this.rule : (
        rule.name == "rate-per-ip" ? rule.statement[0].rate_based_statement[0].limit == 3000 && rule.statement[0].rate_based_statement[0].aggregate_key_type == "IP" :
        rule.name == "public-rate-per-ip" ? rule.statement[0].rate_based_statement[0].limit == 600 && length(rule.statement[0].rate_based_statement[0].scope_down_statement[0].or_statement[0].statement) == 5 :
        true
      )
    ])
    error_message = "Per-IP limits: 3000 requests per 5 minutes overall, 600 on the 5 anonymous route prefixes."
  }

  assert {
    condition = alltrue([
      for rule in aws_wafv2_web_acl.this.rule : rule.name != "common" || toset([
        for override in rule.statement[0].managed_rule_group_statement[0].rule_action_override : override.name
      ]) == toset(["SizeRestrictions_BODY", "SizeRestrictions_QUERYSTRING", "CrossSiteScripting_BODY"])
    ])
    error_message = "The common rule set only counts the body and query string size rules and the body XSS rule."
  }

  assert {
    condition     = length(aws_cloudwatch_log_group.this) == 0 && length(aws_wafv2_web_acl_logging_configuration.this) == 0
    error_message = "WAF logs are off by default."
  }
}

run "waf_with_logs" {
  command = plan

  module {
    source = "../../modules/waf"
  }

  variables {
    name            = "omnipotent-prod"
    logging_enabled = true
  }

  assert {
    condition     = aws_cloudwatch_log_group.this[0].name == "aws-waf-logs-omnipotent-prod"
    error_message = "WAF log groups are named aws-waf-logs-*."
  }

  assert {
    condition = (
      aws_wafv2_web_acl_logging_configuration.this[0].redacted_fields[0].single_header[0].name == "authorization" &&
      aws_wafv2_web_acl_logging_configuration.this[0].logging_filter[0].default_behavior == "DROP"
    )
    error_message = "Only blocked and counted requests are logged, without the Authorization header."
  }
}

run "waf_refuses_an_unknown_window" {
  command = plan

  module {
    source = "../../modules/waf"
  }

  variables {
    name              = "omnipotent-prod"
    rate_limit_window = 30
  }

  expect_failures = [var.rate_limit_window]
}

run "api_edge_headers_waf_and_logs" {
  command = plan

  module {
    source = "../../modules/api-edge"
  }

  variables {
    name                    = "omnipotent-prod"
    alb_dns_name            = "api-1.eu-north-1.elb.amazonaws.com"
    alb_arn                 = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:loadbalancer/app/api/1"
    origin_header_name      = "X-Origin-Verify"
    origin_header_value     = "secret"
    web_acl_arn             = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/omnipotent-prod/abc"
    logs_bucket_domain_name = "omnipotent-prod-access-logs-123456789012.s3.amazonaws.com"
  }

  assert {
    condition = (
      aws_cloudfront_origin_request_policy.api.headers_config[0].header_behavior == "allViewerAndWhitelistCloudFront" &&
      contains(aws_cloudfront_origin_request_policy.api.headers_config[0].headers[0].items, "CloudFront-Viewer-Address")
    )
    error_message = "The API receives every viewer header and CloudFront-Viewer-Address."
  }

  assert {
    condition = (
      aws_cloudfront_distribution.this.default_cache_behavior[0].response_headers_policy_id != null &&
      alltrue([for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior : behavior.response_headers_policy_id != null])
    )
    error_message = "Every behavior of the API sends the managed security headers."
  }

  assert {
    condition = (
      aws_cloudfront_distribution.this.web_acl_id == "arn:aws:wafv2:us-east-1:123456789012:global/webacl/omnipotent-prod/abc" &&
      aws_cloudfront_distribution.this.logging_config[0].prefix == "cloudfront/api/"
    )
    error_message = "The API distribution is behind the web ACL and writes its standard logs."
  }

  assert {
    condition = (
      length(aws_cloudfront_distribution.this.aliases) == 0 &&
      aws_cloudfront_distribution.this.viewer_certificate[0].cloudfront_default_certificate &&
      aws_cloudfront_distribution.this.viewer_certificate[0].acm_certificate_arn == null &&
      length(aws_cloudfront_distribution.this.default_cache_behavior[0].function_association) == 0 &&
      [for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior : behavior.path_pattern] == []
    )
    error_message = "Without a custom hostname, the API keeps the default CloudFront domain and certificate, no function, and caches nothing."
  }

  assert {
    condition = (
      length(aws_cloudfront_distribution.tracking) == 0 &&
      length(aws_cloudfront_function.tracking_not_found) == 0 &&
      length(aws_cloudfront_origin_request_policy.tracking) == 0 &&
      output.tracking_hostname == null
    )
    error_message = "No tracking distribution without a tracking hostname."
  }
}

run "api_edge_on_custom_hostnames" {
  command = apply

  module {
    source = "../../modules/api-edge"
  }

  variables {
    name                     = "omnipotent-prod"
    alb_dns_name             = "api-1.eu-north-1.elb.amazonaws.com"
    alb_arn                  = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:loadbalancer/app/api/1"
    origin_header_name       = "X-Origin-Verify"
    origin_header_value      = "secret"
    web_acl_arn              = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/omnipotent-prod/abc"
    logs_bucket_domain_name  = "omnipotent-prod-access-logs-123456789012.s3.amazonaws.com"
    alias                    = "omnipotent.pinkwhale.co"
    certificate_arn          = "arn:aws:acm:us-east-1:123456789012:certificate/api"
    tracking_alias           = "s.pinkwhale.co"
    tracking_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/tracking"
    # What the phase serving public files to clients' sites will pass, so its behaviour is proven here.
    cached_path_patterns = ["/t/*"]
  }

  assert {
    condition = (
      aws_cloudfront_distribution.this.aliases == toset(["omnipotent.pinkwhale.co"]) &&
      !aws_cloudfront_distribution.this.viewer_certificate[0].cloudfront_default_certificate &&
      aws_cloudfront_distribution.this.viewer_certificate[0].acm_certificate_arn == "arn:aws:acm:us-east-1:123456789012:certificate/api" &&
      aws_cloudfront_distribution.this.viewer_certificate[0].ssl_support_method == "sni-only" &&
      aws_cloudfront_distribution.this.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
    )
    error_message = "The API's custom hostname is served with its certificate over SNI, TLS 1.2 at least."
  }

  assert {
    condition = (
      length(aws_cloudfront_distribution.this.default_cache_behavior[0].function_association) == 0 &&
      [for behavior in aws_cloudfront_distribution.this.ordered_cache_behavior : behavior.path_pattern] == ["/t/*"]
    )
    error_message = "The API's distribution is unchanged otherwise: no function, and it still serves the cached paths of the API host."
  }

  assert {
    condition = (
      aws_cloudfront_distribution.tracking[0].aliases == toset(["s.pinkwhale.co"]) &&
      aws_cloudfront_distribution.tracking[0].viewer_certificate[0].acm_certificate_arn == "arn:aws:acm:us-east-1:123456789012:certificate/tracking" &&
      aws_cloudfront_distribution.tracking[0].viewer_certificate[0].ssl_support_method == "sni-only" &&
      aws_cloudfront_distribution.tracking[0].viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
    )
    error_message = "The tracking host has its own distribution and certificate, TLS 1.2 at least."
  }

  assert {
    condition = (
      [for behavior in aws_cloudfront_distribution.tracking[0].ordered_cache_behavior : behavior.path_pattern] == ["/t/*"] &&
      aws_cloudfront_distribution.tracking[0].ordered_cache_behavior[0].cache_policy_id == aws_cloudfront_cache_policy.origin_cache_control.id &&
      aws_cloudfront_distribution.tracking[0].ordered_cache_behavior[0].origin_request_policy_id == aws_cloudfront_origin_request_policy.tracking[0].id &&
      length(aws_cloudfront_distribution.tracking[0].default_cache_behavior[0].function_association) == 1 &&
      [for association in aws_cloudfront_distribution.tracking[0].default_cache_behavior[0].function_association : association.function_arn] == [aws_cloudfront_function.tracking_not_found[0].arn] &&
      strcontains(aws_cloudfront_function.tracking_not_found[0].code, "statusCode: 404")
    )
    error_message = "Only /t/* reaches the load balancer from the tracking host, cached as the backend says; anything else is a 404 of the edge."
  }

  assert {
    condition = alltrue([
      for behavior in concat(aws_cloudfront_distribution.tracking[0].default_cache_behavior, aws_cloudfront_distribution.tracking[0].ordered_cache_behavior) : (
        toset(behavior.allowed_methods) == toset(["GET", "HEAD"]) &&
        behavior.viewer_protocol_policy == "redirect-to-https" &&
        behavior.response_headers_policy_id == aws_cloudfront_distribution.this.default_cache_behavior[0].response_headers_policy_id
      )
    ])
    error_message = "The tracking host takes GET and HEAD only, in HTTPS, with the API's managed security headers."
  }

  assert {
    condition = (
      aws_cloudfront_origin_request_policy.tracking[0].cookies_config[0].cookie_behavior == "none" &&
      aws_cloudfront_origin_request_policy.tracking[0].query_strings_config[0].query_string_behavior == "none" &&
      aws_cloudfront_origin_request_policy.tracking[0].headers_config[0].header_behavior == "whitelist" &&
      aws_cloudfront_origin_request_policy.tracking[0].headers_config[0].headers[0].items == toset(["CloudFront-Viewer-Address"])
    )
    error_message = "The backend gets the visitors' address only: no cookie, query string or other header."
  }

  assert {
    condition = (
      aws_cloudfront_distribution.tracking[0].web_acl_id == "arn:aws:wafv2:us-east-1:123456789012:global/webacl/omnipotent-prod/abc" &&
      aws_cloudfront_distribution.tracking[0].logging_config[0].prefix == "cloudfront/tracking/" &&
      one(aws_cloudfront_distribution.tracking[0].origin).vpc_origin_config[0].vpc_origin_id == aws_cloudfront_vpc_origin.alb.id &&
      one(aws_cloudfront_distribution.tracking[0].origin).custom_header == one(aws_cloudfront_distribution.this.origin).custom_header
    )
    error_message = "The tracking host is behind the web ACL, logs under cloudfront/tracking/, and reaches the same VPC origin with the secret header."
  }

  assert {
    condition = (
      output.hostname == "omnipotent.pinkwhale.co" &&
      output.tracking_hostname == "s.pinkwhale.co" &&
      output.tracking_domain_name == aws_cloudfront_distribution.tracking[0].domain_name
    )
    error_message = "The module gives the hostnames and the tracking distribution's domain (the CNAME target)."
  }
}

run "api_edge_refuses_a_tracking_hostname_without_certificate" {
  command = plan

  module {
    source = "../../modules/api-edge"
  }

  variables {
    name                = "omnipotent-prod"
    alb_dns_name        = "api-1.eu-north-1.elb.amazonaws.com"
    alb_arn             = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:loadbalancer/app/api/1"
    origin_header_name  = "X-Origin-Verify"
    origin_header_value = "secret"
    tracking_alias      = "s.pinkwhale.co"
  }

  expect_failures = [var.tracking_certificate_arn]
}

run "task_roles_least_privilege" {
  command = plan

  module {
    source = "../../modules/task-roles"
  }

  variables {
    name                    = "omnipotent-prod"
    ecr_repository_arn      = "arn:aws:ecr:eu-north-1:123456789012:repository/omnipotent-backend"
    log_group_prefix        = "/ecs/omnipotent-prod/"
    injected_secret_arns    = ["arn:aws:secretsmanager:eu-north-1:123456789012:secret:rds!db-1-AbCdEf"]
    assets_bucket_arn       = "arn:aws:s3:::assets"
    secrets_prefix          = "omnipotent/prod"
    read_only_secret_arns   = ["arn:aws:secretsmanager:eu-north-1:123456789012:secret:omnipotent/prod/a-platform/api-key-AbCdEf"]
    app_written_secret_arns = ["arn:aws:secretsmanager:eu-north-1:123456789012:secret:omnipotent/prod/a-platform/oauth-AbCdEf"]
    db_connect_arns         = ["arn:aws:rds-db:eu-north-1:123456789012:dbuser:db-ABC/omnipotent_app"]
    sidecar_repository_arns = ["arn:aws:ecr:eu-north-1:591436053604:repository/aws-guardduty-agent-fargate"]
  }

  assert {
    condition = alltrue([
      for statement in data.aws_iam_policy_document.execution.statement : statement.sid != "EcrPull" || toset(statement.resources) == toset([
        "arn:aws:ecr:eu-north-1:123456789012:repository/omnipotent-backend",
        "arn:aws:ecr:eu-north-1:591436053604:repository/aws-guardduty-agent-fargate",
      ])
    ])
    error_message = "The execution role pulls the backend image and the sidecar images it is given, nothing else."
  }

  assert {
    condition = alltrue([
      for statement in data.aws_iam_policy_document.task.statement : !contains(statement.resources, "arn:aws:secretsmanager:eu-north-1:123456789012:secret:omnipotent/prod/*")
    ])
    error_message = "No statement covers every secret of the prefix."
  }

  assert {
    condition = alltrue([
      for statement in data.aws_iam_policy_document.task.statement : (
        statement.sid == "ReadOperatorSecrets" ? toset(statement.actions) == toset(["secretsmanager:GetSecretValue"]) :
        statement.sid == "AppWrittenSecrets" ? !contains(statement.actions, "secretsmanager:DeleteSecret") && !contains(statement.actions, "secretsmanager:CreateSecret") :
        statement.sid == "OrganizationSecrets" ? toset(statement.resources) == toset(["arn:aws:secretsmanager:eu-north-1:123456789012:secret:omnipotent/prod/????????-????-????-????-????????????/*"]) :
        true
      )
    ])
    error_message = "Hand-filled secrets are read only, Terraform's containers are never created or deleted, the organizations' secrets are confined to <prefix>/<uuid>/."
  }

  assert {
    condition     = contains(flatten([for statement in data.aws_iam_policy_document.task.statement : statement.actions]), "rds-db:connect")
    error_message = "The task role may sign in as the application database role."
  }

  assert {
    condition     = aws_iam_role.migrate.name == "omnipotent-prod-migrate-task"
    error_message = "The migration task has its own role."
  }
}

run "guardduty_defaults" {
  command = plan

  module {
    source = "../../modules/guardduty"
  }

  variables {
    name            = "omnipotent-prod"
    alarm_topic_arn = "arn:aws:sns:eu-north-1:123456789012:omnipotent-prod-alarms"
  }

  assert {
    condition     = aws_guardduty_detector.this.enable && aws_guardduty_detector.this.finding_publishing_frequency == "SIX_HOURS"
    error_message = "An enabled detector, updates of a finding published every six hours."
  }

  assert {
    condition = (
      aws_guardduty_detector_feature.s3.name == "S3_DATA_EVENTS" && aws_guardduty_detector_feature.s3.status == "ENABLED" &&
      aws_guardduty_detector_feature.rds.name == "RDS_LOGIN_EVENTS" && aws_guardduty_detector_feature.rds.status == "ENABLED"
    )
    error_message = "S3 Protection and RDS Protection are on by default."
  }

  assert {
    condition = (
      aws_guardduty_detector_feature.runtime_monitoring.status == "DISABLED" &&
      alltrue([for configuration in aws_guardduty_detector_feature.runtime_monitoring.additional_configuration : configuration.status == "DISABLED"]) &&
      length(output.fargate_agent_repository_arns) == 0
    )
    error_message = "Runtime Monitoring is off by default, without any agent deployment."
  }

  assert {
    condition = (
      jsondecode(aws_cloudwatch_event_rule.findings.event_pattern).source == ["aws.guardduty"] &&
      jsondecode(aws_cloudwatch_event_rule.findings.event_pattern)["detail-type"] == ["GuardDuty Finding"] &&
      jsondecode(aws_cloudwatch_event_rule.findings.event_pattern).detail.severity == [{ numeric = [">=", 4] }]
    )
    error_message = "The rule matches the GuardDuty findings of medium severity (4) and above."
  }

  assert {
    condition = (
      aws_cloudwatch_event_target.alarm_topic.arn == "arn:aws:sns:eu-north-1:123456789012:omnipotent-prod-alarms" &&
      aws_cloudwatch_event_target.alarm_topic.input_transformer[0].input_paths["severity"] == "$.detail.severity" &&
      aws_cloudwatch_event_target.alarm_topic.input_transformer[0].input_paths["title"] == "$.detail.title" &&
      strcontains(aws_cloudwatch_event_target.alarm_topic.input_transformer[0].input_template, "\"<title>\"") &&
      strcontains(aws_cloudwatch_event_target.alarm_topic.input_transformer[0].input_template, "fId=<id>")
    )
    error_message = "The findings go to the alarm topic as readable text: severity, title, type, description, link."
  }

  assert {
    condition = alltrue([
      for name in regexall("<([a-z_]+)>", aws_cloudwatch_event_target.alarm_topic.input_transformer[0].input_template) :
      contains(keys(aws_cloudwatch_event_target.alarm_topic.input_transformer[0].input_paths), name[0])
    ])
    error_message = "Every placeholder of the template is an input path."
  }
}

run "guardduty_with_runtime_monitoring" {
  command = plan

  module {
    source = "../../modules/guardduty"
  }

  variables {
    name               = "omnipotent-prod"
    alarm_topic_arn    = "arn:aws:sns:eu-north-1:123456789012:omnipotent-prod-alarms"
    runtime_monitoring = true
    alert_min_severity = 7
  }

  assert {
    condition = (
      aws_guardduty_detector_feature.runtime_monitoring.status == "ENABLED" &&
      toset([for configuration in aws_guardduty_detector_feature.runtime_monitoring.additional_configuration : "${configuration.name}=${configuration.status}"]) == toset([
        "ECS_FARGATE_AGENT_MANAGEMENT=ENABLED", "EC2_AGENT_MANAGEMENT=DISABLED", "EKS_ADDON_MANAGEMENT=DISABLED",
      ])
    )
    error_message = "Runtime Monitoring deploys GuardDuty's agent to the Fargate tasks only."
  }

  assert {
    condition     = tolist(output.fargate_agent_repository_arns) == tolist(["arn:aws:ecr:eu-north-1:591436053604:repository/aws-guardduty-agent-fargate"])
    error_message = "The execution role must be allowed to pull the agent from GuardDuty's repository of the region."
  }

  assert {
    condition     = jsondecode(aws_cloudwatch_event_rule.findings.event_pattern).detail.severity == [{ numeric = [">=", 7] }]
    error_message = "alert_min_severity moves the threshold of the e-mails."
  }
}

run "guardduty_runtime_monitoring_needs_a_known_region" {
  command = plan

  module {
    source = "../../modules/guardduty"
  }

  variables {
    name               = "omnipotent-prod"
    alarm_topic_arn    = "arn:aws:sns:ap-east-2:123456789012:omnipotent-prod-alarms"
    runtime_monitoring = true
  }

  override_data {
    target = data.aws_region.current
    values = { region = "ap-east-2" }
  }

  expect_failures = [aws_guardduty_detector_feature.runtime_monitoring]
}

run "guardduty_refuses_an_unknown_severity" {
  command = plan

  module {
    source = "../../modules/guardduty"
  }

  variables {
    name               = "omnipotent-prod"
    alarm_topic_arn    = "arn:aws:sns:eu-north-1:123456789012:omnipotent-prod-alarms"
    alert_min_severity = 0
  }

  expect_failures = [var.alert_min_severity]
}

run "guardduty_refuses_an_unknown_frequency" {
  command = plan

  module {
    source = "../../modules/guardduty"
  }

  variables {
    name                         = "omnipotent-prod"
    alarm_topic_arn              = "arn:aws:sns:eu-north-1:123456789012:omnipotent-prod-alarms"
    finding_publishing_frequency = "DAILY"
  }

  expect_failures = [var.finding_publishing_frequency]
}

run "alarm_topic_accepts_the_eventbridge_rules" {
  command = apply

  module {
    source = "../../modules/monitoring"
  }

  variables {
    name                       = "omnipotent-prod"
    alb_arn_suffix             = "app/api/1"
    target_group_arn_suffix    = "targetgroup/api/1"
    cluster_name               = "omnipotent-prod"
    service_names              = ["api", "worker"]
    container_insights_enabled = true
    db_instance_identifier     = "omnipotent-prod"
  }

  assert {
    condition = length([
      for statement in data.aws_iam_policy_document.alarms.statement : statement
      if statement.sid == "EventBridgeRules" &&
      statement.actions == toset(["SNS:Publish"]) &&
      anytrue([for principal in statement.principals : contains(principal.identifiers, "events.amazonaws.com")]) &&
      anytrue([for condition in statement.condition : condition.variable == "aws:SourceArn" && contains(condition.values, "arn:aws:events:eu-north-1:123456789012:rule/omnipotent-prod-*")])
    ]) == 1
    error_message = "EventBridge may publish to the alarm topic for the rules of this stack only."
  }
}

run "flow_logs_to_s3" {
  command = plan

  module {
    source = "../../modules/network"
  }

  variables {
    name                      = "omnipotent-prod"
    enable_flow_logs          = true
    flow_logs_destination_arn = "arn:aws:s3:::omnipotent-prod-access-logs-123456789012/vpc-flow/"
  }

  assert {
    condition = (
      aws_flow_log.this[0].traffic_type == "ALL" &&
      aws_flow_log.this[0].log_destination_type == "s3" &&
      aws_flow_log.this[0].log_destination == "arn:aws:s3:::omnipotent-prod-access-logs-123456789012/vpc-flow/" &&
      aws_flow_log.this[0].max_aggregation_interval == 600
    )
    error_message = "The flow logs of the whole VPC, all traffic, go to the access logs bucket under vpc-flow/, in 10-minute windows."
  }

  assert {
    condition = (
      aws_flow_log.this[0].destination_options[0].file_format == "plain-text" &&
      !aws_flow_log.this[0].destination_options[0].per_hour_partition &&
      !aws_flow_log.this[0].destination_options[0].hive_compatible_partitions
    )
    error_message = "Plain text (no Parquet conversion fee), daily folders."
  }
}

run "flow_logs_need_a_destination" {
  command = plan

  module {
    source = "../../modules/network"
  }

  variables {
    name             = "omnipotent-prod"
    enable_flow_logs = true
  }

  expect_failures = [var.flow_logs_destination_arn]
}

run "access_logs_bucket_accepts_the_flow_logs" {
  command = apply

  module {
    source = "../../modules/access-logs"
  }

  variables {
    bucket_name = "omnipotent-prod-access-logs-123456789012"
  }

  assert {
    condition = length([
      for statement in data.aws_iam_policy_document.bucket.statement : statement
      if statement.sid == "FlowLogsWrite" &&
      statement.resources == toset(["arn:aws:s3:::bucket/vpc-flow/AWSLogs/123456789012/*"]) &&
      anytrue([for principal in statement.principals : contains(principal.identifiers, "delivery.logs.amazonaws.com")]) &&
      anytrue([for condition in statement.condition : condition.variable == "s3:x-amz-acl" && contains(condition.values, "bucket-owner-full-control")]) &&
      anytrue([for condition in statement.condition : condition.variable == "aws:SourceArn" && contains(condition.values, "arn:aws:logs:eu-north-1:123456789012:*")])
    ]) == 1
    error_message = "The log delivery service may write this account's flow logs under vpc-flow/ only."
  }

  assert {
    condition     = contains([for statement in data.aws_iam_policy_document.bucket.statement : statement.sid], "FlowLogsAclCheck")
    error_message = "The log delivery service may check the bucket ACL."
  }

  assert {
    condition     = output.flow_logs_destination_arn == "arn:aws:s3:::bucket/vpc-flow/"
    error_message = "The flow logs go under vpc-flow/ of the bucket."
  }
}
