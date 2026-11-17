# Offline test of the test environment: `terraform test` plans and applies the configuration (production's, linked)
# with the defaults of test_override.tf, against MOCKED providers, without any AWS account or call. It checks what the
# test account requires: no GuardDuty, no GitHub OIDC provider or deploy role, no WAF, no account-wide resource, every
# name prefixed with omnipotent-test, the smaller sizes, and the tasks' way out without NAT gateway.
#
#   terraform init -backend=false && terraform test

# The mocks of envs/prod's tests, as the test account.
mock_provider "aws" {
  source = "../prod/tests/mocks/aws"

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "903305161052"
    }
  }
}

mock_provider "aws" {
  alias  = "us_east_1"
  source = "../prod/tests/mocks/aws-us-east-1"
}

mock_provider "random" {}

# What terraform.tfvars.example sets.
variables {
  auth0_domain        = "dev-u4wj2een0nvlqbga.eu.auth0.com"
  auth0_audience      = "https://api.pinkwhale.app"
  auth0_spa_client_id = "7E8vA7Svbz317jd5zDrOw8zrmiCLPuRn"
  omnipass_client_id  = "wyPvM8SDC6ZSYwzOUJSHDIGhYn4YQ1kY"
}

run "apply_with_test_defaults" {
  command = apply

  assert {
    condition     = local.name == "omnipotent-test" && var.environment == "test" && var.allowed_account_ids == tolist(["903305161052"])
    error_message = "The test environment is omnipotent-test, pinned to the test account."
  }

  # What the organization's policies deny, or what would be account-wide.
  assert {
    condition = (
      length(module.guardduty) == 0 && output.guardduty_detector_id == null &&
      length(module.github_oidc) == 0 && output.deploy_role_arn == null && output.github_settings == null &&
      length(module.audit_trail) == 0 &&
      length(module.waf) == 0 && output.waf_web_acl == null &&
      var.monthly_budget_usd == null
    )
    error_message = "No GuardDuty detector, GitHub OIDC provider or deploy role, CloudTrail trail, WAF web ACL or account budget in the test account."
  }

  assert {
    condition = alltrue([
      for name in [
        module.ecr.repository_name,
        module.ecs_cluster.cluster_name,
        module.database.identifier,
        module.storage.bucket_name,
        module.api.task_family,
        module.worker.task_family,
        module.migrate.task_family,
      ] : startswith(name, "omnipotent-test-") || name == "omnipotent-test"
    ])
    error_message = "Every resource name starts with omnipotent-test."
  }

  assert {
    condition = (
      module.ecr.repository_name == "omnipotent-test-backend" &&
      module.storage.bucket_name == "omnipotent-test-assets-903305161052"
    )
    error_message = "The image repository and the bucket carry the environment (and the account id, for the bucket)."
  }

  assert {
    condition = (
      alltrue([for name in values(module.secrets.names) : startswith(name, "omnipotent/test/")]) &&
      alltrue([for name in module.deploy_parameters.names : startswith(name, "/omnipotent/test/deploy/")]) &&
      alltrue([for group in [module.api.log_group_name, module.worker.log_group_name, module.migrate.log_group_name] : startswith(group, "/ecs/omnipotent-test/")]) &&
      local.common_environment["SECRETS_PREFIX"] == "omnipotent/test"
    )
    error_message = "The secrets, the deploy parameters and the log groups live under the test environment's prefix."
  }

  # No NAT gateway: the tasks run in the public subnets with a public IP, the migration task too.
  assert {
    condition = (
      length(output.nat_egress_ips) == 0 &&
      local.tasks_public_ip &&
      local.tasks_subnet_ids == module.network.public_subnet_ids &&
      local.deploy_parameters["migrate-subnets"] == join(",", module.network.public_subnet_ids) &&
      local.deploy_parameters["migrate-assign-public-ip"] == "ENABLED"
    )
    error_message = "Without NAT gateway, the tasks (and the migration task the deploy runs) use the public subnets and a public IP."
  }

  assert {
    condition = (
      var.db_instance_class == "db.t4g.small" && !var.db_multi_az && var.db_apply_immediately && var.db_backup_retention_days == 1 &&
      var.api_cpu == 256 && var.api_memory == 512 && var.api_desired_count == 1 && var.api_min_count == 1 && var.api_max_count == 2 &&
      var.worker_cpu == 256 && var.worker_memory == 1024 &&
      var.container_insights == "disabled" && var.log_retention_days == 7 && var.access_logs_retention_days == 14
    )
    error_message = "The test sizes: db.t4g.small single-AZ applied at once, one small API task (two at most), one worker, short retentions."
  }

  assert {
    condition     = var.db_free_memory_alarm_bytes == 134217728
    error_message = "The test database (db.t4g.small, 2 GB) keeps production's 128 MB memory alarm."
  }

  assert {
    condition     = var.force_destroy && local.edge_logs_bucket_domain_name == null && var.enable_flow_logs
    error_message = "A disposable environment, without CloudFront or load balancer access logs, with the VPC flow logs."
  }

  assert {
    condition = (
      length(aws_acm_certificate.domain) == 0 &&
      output.api_url == "https://d123.cloudfront.net" &&
      output.mcp_url == "https://d123.cloudfront.net/mcp" &&
      output.auth0_settings.mcp_api_identifier == output.mcp_url
    )
    error_message = "No custom domain: the default CloudFront domain, and the MCP API identifier on the API's."
  }

  assert {
    condition = (
      local.api_environment["APP_DOCS_ENABLED"] == "true" &&
      contains(output.auth0_settings.spa_allowed_callback_urls, "https://d123.cloudfront.net/documentation/static/oauth2-redirect.html") &&
      local.common_environment["DB_IAM_AUTH"] == "true"
    )
    error_message = "The Swagger UI is on, with its Auth0 callback, and the database is signed in to with IAM tokens."
  }

  # A disposable account holding no real data: the backend may run its local implementations of the identity and
  # the rights there, which production refuses (D43).
  assert {
    condition     = local.common_environment["NODE_ENV"] == "dev"
    error_message = "The test environment runs under NODE_ENV=dev: readable 5xx messages, and no production configuration."
  }
}

# The production features can still be switched on in the test account (they may be refused there: infra/README.md).
run "plan_with_nat_and_waf" {
  command = plan

  variables {
    task_egress = "nat"
    waf_enabled = true
  }

  assert {
    condition = (
      length(module.waf) == 1 &&
      !local.tasks_public_ip &&
      local.deploy_parameters["migrate-assign-public-ip"] == "DISABLED"
    )
    error_message = "task_egress = nat puts the tasks back in the private subnets, waf_enabled the web ACL."
  }
}

run "refuse_an_unknown_egress" {
  command = plan

  variables {
    task_egress = "nat-instance"
  }

  expect_failures = [var.task_egress]
}

run "refuse_nat_per_zone_without_nat" {
  command = plan

  variables {
    nat_gateway_per_az = true
  }

  expect_failures = [var.nat_gateway_per_az]
}

# ---------------------------------------------------------------------------------------------------
# Modules on their own: the switches the test environment uses
# ---------------------------------------------------------------------------------------------------

run "network_without_nat_gateway" {
  command = apply

  module {
    source = "../../modules/network"
  }

  variables {
    name                = "omnipotent-test"
    nat_gateway_enabled = false
  }

  assert {
    condition = (
      length(aws_nat_gateway.this) == 0 &&
      length(aws_eip.nat) == 0 &&
      length(aws_route.private_nat) == 0 &&
      length(output.nat_public_ips) == 0
    )
    error_message = "Without NAT gateway: no gateway, no Elastic IP, no route to the internet from the private subnets."
  }

  assert {
    condition     = aws_route.public_internet.gateway_id == aws_internet_gateway.this.id && length(output.public_subnet_ids) == 2
    error_message = "The public subnets keep their route to the internet gateway."
  }
}

run "network_with_one_nat_gateway" {
  command = apply

  module {
    source = "../../modules/network"
  }

  variables {
    name = "omnipotent-prod"
  }

  assert {
    condition     = length(aws_nat_gateway.this) == 1 && length(aws_route.private_nat) == 2 && length(output.nat_public_ips) == 1
    error_message = "By default, one NAT gateway serves the private subnets of both zones."
  }
}

run "service_with_a_public_ip" {
  command = plan

  module {
    source = "../../modules/ecs-service"
  }

  variables {
    name               = "worker"
    family             = "omnipotent-test-worker"
    cluster_arn        = "arn:aws:ecs:eu-north-1:903305161052:cluster/omnipotent-test"
    image              = "903305161052.dkr.ecr.eu-north-1.amazonaws.com/omnipotent-test-backend:bootstrap"
    task_role_arn      = "arn:aws:iam::903305161052:role/omnipotent-test-task"
    execution_role_arn = "arn:aws:iam::903305161052:role/omnipotent-test-task-execution"
    log_group_name     = "/ecs/omnipotent-test/worker"
    subnet_ids         = ["subnet-public-a", "subnet-public-b"]
    assign_public_ip   = true
  }

  assert {
    condition     = aws_ecs_service.this[0].network_configuration[0].assign_public_ip
    error_message = "assign_public_ip gives the tasks a public IP."
  }
}

run "disposable_database" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    identifier                = "omnipotent-test"
    vpc_id                    = "vpc-1"
    subnet_ids                = ["subnet-a", "subnet-b"]
    client_security_group_ids = ["sg-tasks"]
    instance_class            = "db.t4g.small"
    backup_retention_days     = 1
    deletion_protection       = false
    skip_final_snapshot       = true
    delete_automated_backups  = true
  }

  assert {
    condition = (
      !aws_db_instance.this.deletion_protection &&
      aws_db_instance.this.skip_final_snapshot &&
      aws_db_instance.this.final_snapshot_identifier == null &&
      aws_db_instance.this.delete_automated_backups &&
      aws_db_instance.this.backup_retention_period == 1 &&
      aws_db_instance.this.instance_class == "db.t4g.small"
    )
    error_message = "A disposable database: deletable, no final snapshot, no backup kept."
  }
}

run "kept_database_by_default" {
  command = plan

  module {
    source = "../../modules/database"
  }

  variables {
    identifier                = "omnipotent-prod"
    vpc_id                    = "vpc-1"
    subnet_ids                = ["subnet-a", "subnet-b"]
    client_security_group_ids = ["sg-tasks"]
  }

  assert {
    condition = (
      aws_db_instance.this.deletion_protection &&
      !aws_db_instance.this.skip_final_snapshot &&
      aws_db_instance.this.final_snapshot_identifier == "omnipotent-prod-final" &&
      !aws_db_instance.this.delete_automated_backups &&
      aws_db_instance.this.backup_retention_period == 7
    )
    error_message = "By default the database is protected, leaves a final snapshot and keeps its backups."
  }
}

run "disposable_buckets" {
  command = plan

  module {
    source = "../../modules/storage"
  }

  variables {
    bucket_name   = "omnipotent-test-assets-903305161052"
    force_destroy = true
  }

  assert {
    condition     = aws_s3_bucket.this.force_destroy
    error_message = "force_destroy lets terraform destroy empty the bucket."
  }
}

run "disposable_repository" {
  command = plan

  module {
    source = "../../modules/ecr"
  }

  variables {
    name         = "omnipotent-test-backend"
    force_delete = true
  }

  assert {
    condition     = aws_ecr_repository.this.force_delete && aws_ecr_repository.this.image_tag_mutability == "IMMUTABLE"
    error_message = "force_delete lets terraform destroy delete the images; tags stay immutable."
  }
}
