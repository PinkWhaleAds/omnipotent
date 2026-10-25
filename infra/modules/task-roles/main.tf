data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.region
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:ecs:${local.region}:${local.account_id}:*"]
    }
  }
}

# Execution role: used by the ECS agent, before the application starts, to pull the image, write the
# logs and read the secrets injected into the environment (DB_PASSWORD, ANTHROPIC_API_KEY).
resource "aws_iam_role" "execution" {
  name               = "${var.name}-task-execution"
  description        = "ECS agent: pull the image, write the logs, inject the secrets"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

data "aws_iam_policy_document" "execution" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPull"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = concat([var.ecr_repository_arn], var.sidecar_repository_arns)
  }

  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:${local.region}:${local.account_id}:log-group:${var.log_group_prefix}*"]
  }

  statement {
    sid       = "InjectedSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.injected_secret_arns
  }
}

resource "aws_iam_role_policy" "execution" {
  name   = "pull-log-inject"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution.json
}

# Task role: what the application itself may do. Its bucket, its secrets and, with IAM database
# authentication, signing in to PostgreSQL as the application role; nothing else. A phase that needs another
# AWS service (Amazon Location for the geocoding, Bedrock…) adds its statement here, scoped to its resources.
resource "aws_iam_role" "task" {
  name               = "${var.name}-task"
  description        = "Omnipotent backend: its bucket, its secrets, database sign-in"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

locals {
  # The credentials the backend writes itself under <prefix>/<organization id>/... (the keys of the platform
  # accounts of an Organization, from the phase of each platform). The ARN of a secret ends with a random
  # 6-character suffix, which the trailing * covers.
  organization_secrets_arn = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:${var.secrets_prefix}/????????-????-????-????-????????????/*"
}

data "aws_iam_policy_document" "task" {
  statement {
    sid       = "AssetsBucket"
    actions   = ["s3:ListBucket"]
    resources = [var.assets_bucket_arn]
  }

  statement {
    sid = "AssetsObjects"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${var.assets_bucket_arn}/*"]
  }

  # Filled by hand (a platform's service account, an API key): read only.
  statement {
    sid       = "ReadOperatorSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.read_only_secret_arns
  }

  # Created empty by Terraform, written by the backend (OAuth tokens at each refresh, a signing key the first
  # time): read and write their value, never create or delete them.
  statement {
    sid = "AppWrittenSecrets"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
    ]
    resources = var.app_written_secret_arns
  }

  # Created and deleted by the backend when an account of an Organization is connected or removed.
  statement {
    sid = "OrganizationSecrets"
    actions = [
      "secretsmanager:CreateSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
    ]
    resources = [local.organization_secrets_arn]
  }

  # RDS IAM authentication: an authentication token for the application role only (not the master user).
  dynamic "statement" {
    for_each = length(var.db_connect_arns) > 0 ? [var.db_connect_arns] : []

    content {
      sid       = "DatabaseSignIn"
      actions   = ["rds-db:connect"]
      resources = statement.value
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "assets-and-secrets"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

# Task role of the migration task: no permission at all. It connects to PostgreSQL as the master user with the
# password the execution role injects, and calls no AWS API (no bucket, no secret).
resource "aws_iam_role" "migrate" {
  name               = "${var.name}-migrate-task"
  description        = "omnipotent migrations: no AWS permission"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}
