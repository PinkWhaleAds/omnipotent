# Amazon GuardDuty in the region of the stack, its findings of medium severity and above e-mailed through the alarm
# topic. The detector analyses the account's CloudTrail management events (and the VPC flow logs and DNS queries of
# EC2 instances, of which this stack has none), plus the protection plans below:
#
#   S3_DATA_EVENTS      S3 Protection: the data events of the account's buckets;
#   RDS_LOGIN_EVENTS    RDS Protection: the sign-ins to the PostgreSQL instance;
#   RUNTIME_MONITORING  the GuardDuty agent as a sidecar of every new Fargate task (off by default: cost, memory).
#
# The other plans (EKS, Lambda, malware scans of EC2 volumes) have nothing to watch here and cost nothing without EKS
# clusters, Lambda functions or EC2 instances: they keep GuardDuty's default. GuardDuty creates its service-linked role
# itself, and, with Runtime Monitoring, a VPC endpoint and its security group in the VPC (free).
data "aws_region" "current" {}

locals {
  region = data.aws_region.current.region

  # Account of the ECR repository aws-guardduty-agent-fargate (GuardDuty's Fargate agent) in each European region,
  # from the GuardDuty user guide ("ECR repository for GuardDuty agent on AWS Fargate (Amazon ECS only)"). The task
  # execution role must be allowed to pull it.
  fargate_agent_accounts = {
    "eu-central-1" = "323658145986"
    "eu-central-2" = "529164026651"
    "eu-north-1"   = "591436053604"
    "eu-south-1"   = "266869475730"
    "eu-south-2"   = "919611009337"
    "eu-west-1"    = "694911143906"
    "eu-west-2"    = "892757235363"
    "eu-west-3"    = "665651866788"
  }
  fargate_agent_repository_arn = "arn:aws:ecr:${local.region}:${lookup(local.fargate_agent_accounts, local.region, "unknown")}:repository/aws-guardduty-agent-fargate"

  runtime_monitoring_status = var.runtime_monitoring ? "ENABLED" : "DISABLED"
}

resource "aws_guardduty_detector" "this" {
  enable                       = true
  finding_publishing_frequency = var.finding_publishing_frequency

  tags = { Name = var.name }
}

resource "aws_guardduty_detector_feature" "s3" {
  detector_id = aws_guardduty_detector.this.id
  name        = "S3_DATA_EVENTS"
  status      = var.s3_protection ? "ENABLED" : "DISABLED"
}

# Login activity. The data activity monitoring of RDS Protection (its additional configuration RDS_DATA_RISK: unusual
# volumes read, data deleted, access from Tor or known malicious addresses; $3 per vCPU and month) is not known to
# the AWS provider yet (6.68): it is left as GuardDuty sets it and switched with the CLI (infra/README.md, "Threat
# detection"). Hence ignore_changes, or every plan would try to remove it.
resource "aws_guardduty_detector_feature" "rds" {
  detector_id = aws_guardduty_detector.this.id
  name        = "RDS_LOGIN_EVENTS"
  status      = var.rds_protection ? "ENABLED" : "DISABLED"

  lifecycle {
    ignore_changes = [additional_configuration]
  }
}

# Managed even when off, so that the account's state is explicit: GuardDuty deploys its agent to the Fargate tasks
# only (no EC2 instance, no EKS cluster here). The tasks started before it is switched on are not covered: redeploy.
resource "aws_guardduty_detector_feature" "runtime_monitoring" {
  detector_id = aws_guardduty_detector.this.id
  name        = "RUNTIME_MONITORING"
  status      = local.runtime_monitoring_status

  additional_configuration {
    name   = "ECS_FARGATE_AGENT_MANAGEMENT"
    status = local.runtime_monitoring_status
  }

  additional_configuration {
    name   = "EC2_AGENT_MANAGEMENT"
    status = "DISABLED"
  }

  additional_configuration {
    name   = "EKS_ADDON_MANAGEMENT"
    status = "DISABLED"
  }

  lifecycle {
    precondition {
      condition     = !var.runtime_monitoring || contains(keys(local.fargate_agent_accounts), local.region)
      error_message = "Runtime Monitoring needs the account of GuardDuty's Fargate agent repository in this region: add it to local.fargate_agent_accounts (GuardDuty user guide)."
    }
  }
}

# Every finding of the alert severity or more, new or updated (finding_publishing_frequency), to the alarm topic as a
# plain-text e-mail. GuardDuty publishes to EventBridge in its own region.
resource "aws_cloudwatch_event_rule" "findings" {
  name        = "${var.name}-guardduty-findings"
  description = "GuardDuty findings of severity ${var.alert_min_severity} or more: e-mailed through the alarm topic"

  event_pattern = jsonencode({
    source        = ["aws.guardduty"]
    "detail-type" = ["GuardDuty Finding"]
    detail = {
      severity = [{ numeric = [">=", var.alert_min_severity] }]
    }
  })
}

# One quoted string per line (EventBridge's input template for text output); the e-mail shows them one under the other.
resource "aws_cloudwatch_event_target" "alarm_topic" {
  rule      = aws_cloudwatch_event_rule.findings.name
  target_id = "alarm-topic"
  arn       = var.alarm_topic_arn

  input_transformer {
    input_paths = {
      severity    = "$.detail.severity"
      title       = "$.detail.title"
      type        = "$.detail.type"
      description = "$.detail.description"
      resource    = "$.detail.resource.resourceType"
      account     = "$.detail.accountId"
      region      = "$.detail.region"
      count       = "$.detail.service.count"
      first_seen  = "$.detail.service.eventFirstSeen"
      last_seen   = "$.detail.service.eventLastSeen"
      id          = "$.detail.id"
    }

    input_template = <<-EOT
      "GuardDuty finding of severity <severity> (medium 4 to 6.9, high 7 to 8.9, critical 9 to 10):"
      "<title>"
      ""
      "Type: <type>"
      "Resource: <resource>"
      "Account <account>, region <region>. Seen <count> time(s), first <first_seen>, last <last_seen>."
      ""
      "<description>"
      ""
      "Finding: https://<region>.console.aws.amazon.com/guardduty/home?region=<region>#/findings?macros=current&fId=<id>"
      "What to do: infra/README.md, Threat detection."
    EOT
  }
}
