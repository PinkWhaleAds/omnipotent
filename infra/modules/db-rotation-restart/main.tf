# ECS reads DB_PASSWORD from the RDS-managed secret when a task STARTS. When RDS rotates the password,
# the running tasks keep the old one and their new database connections start failing. This module
# listens for the end of each rotation (CloudTrail event RotationSucceeded, which needs a trail: module
# audit-trail) and forces a new deployment of the services, whose new tasks read the new password.
data "aws_iam_policy_document" "sfn_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["states.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sfn" {
  name               = "${var.name}-db-rotation-restart"
  description        = "Redeploy the ECS services after a database password rotation"
  assume_role_policy = data.aws_iam_policy_document.sfn_assume.json
}

data "aws_iam_policy_document" "sfn" {
  statement {
    actions   = ["ecs:UpdateService"]
    resources = values(var.services)
  }
}

resource "aws_iam_role_policy" "sfn" {
  name   = "update-services"
  role   = aws_iam_role.sfn.id
  policy = data.aws_iam_policy_document.sfn.json
}

resource "aws_sfn_state_machine" "this" {
  name     = "${var.name}-db-rotation-restart"
  role_arn = aws_iam_role.sfn.arn
  type     = "STANDARD"

  definition = jsonencode({
    Comment = "Redeploy the ECS services so that their tasks read the rotated database password"
    StartAt = "RedeployServices"
    States = {
      RedeployServices = {
        Type = "Parallel"
        End  = true
        Branches = [
          for service in sort(keys(var.services)) : {
            StartAt = "Redeploy-${service}"
            States = {
              "Redeploy-${service}" = {
                Type     = "Task"
                Resource = "arn:aws:states:::aws-sdk:ecs:updateService"
                Parameters = {
                  Cluster            = var.cluster_arn
                  Service            = service
                  ForceNewDeployment = true
                }
                Retry = [{
                  ErrorEquals     = ["States.ALL"]
                  IntervalSeconds = 10
                  MaxAttempts     = 5
                  BackoffRate     = 2
                }]
                End = true
              }
            }
          }
        ]
      }
    }
  })
}

data "aws_iam_policy_document" "events_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "events" {
  name               = "${var.name}-db-rotation-events"
  description        = "EventBridge starts the redeploy after a database password rotation"
  assume_role_policy = data.aws_iam_policy_document.events_assume.json
}

data "aws_iam_policy_document" "events" {
  statement {
    actions   = ["states:StartExecution"]
    resources = [aws_sfn_state_machine.this.arn]
  }
}

resource "aws_iam_role_policy" "events" {
  name   = "start-redeploy"
  role   = aws_iam_role.events.id
  policy = data.aws_iam_policy_document.events.json
}

resource "aws_cloudwatch_event_rule" "rotation_succeeded" {
  name        = "${var.name}-db-password-rotated"
  description = "The RDS master password was rotated: redeploy the ECS services"

  event_pattern = jsonencode({
    source = ["aws.secretsmanager"]
    detail = {
      eventSource         = ["secretsmanager.amazonaws.com"]
      eventName           = ["RotationSucceeded"]
      additionalEventData = { SecretId = [var.secret_arn] }
    }
  })
}

resource "aws_cloudwatch_event_target" "redeploy" {
  rule     = aws_cloudwatch_event_rule.rotation_succeeded.name
  arn      = aws_sfn_state_machine.this.arn
  role_arn = aws_iam_role.events.arn
}

resource "aws_cloudwatch_metric_alarm" "redeploy_failed" {
  alarm_name          = "${var.name}-db-rotation-redeploy-failed"
  alarm_description   = "The redeploy after a database password rotation failed: run `aws ecs update-service --force-new-deployment` for the api and worker services."
  namespace           = "AWS/States"
  metric_name         = "ExecutionsFailed"
  dimensions          = { StateMachineArn = aws_sfn_state_machine.this.arn }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alarm_topic_arn]
}
