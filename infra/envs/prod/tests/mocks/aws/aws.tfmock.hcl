# Mocked AWS responses of the offline tests (terraform test, no AWS call), shared by envs/prod and envs/test
# (mock_provider "aws" { source = ... }). The values only need the right shape: an ARN where one is expected.

mock_data "aws_availability_zones" {
  defaults = {
    names = ["eu-north-1a", "eu-north-1b", "eu-north-1c"]
  }
}

mock_data "aws_region" {
  defaults = {
    region = "eu-north-1"
  }
}

mock_data "aws_caller_identity" {
  defaults = {
    account_id = "123456789012"
  }
}

mock_data "aws_iam_policy_document" {
  defaults = {
    json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
  }
}

mock_resource "aws_ecs_cluster" {
  defaults = {
    arn = "arn:aws:ecs:eu-north-1:123456789012:cluster/omnipotent-prod"
  }
}

mock_resource "aws_ecs_service" {
  defaults = {
    id = "arn:aws:ecs:eu-north-1:123456789012:service/omnipotent-prod/service"
  }
}

mock_resource "aws_ecs_task_definition" {
  defaults = {
    arn = "arn:aws:ecs:eu-north-1:123456789012:task-definition/family:1"
  }
}

mock_resource "aws_db_instance" {
  defaults = {
    identifier = "omnipotent-prod"
    address    = "omnipotent-prod.abc.eu-north-1.rds.amazonaws.com"
    port       = 5432
    db_name    = "omnipotent"
    username   = "omnipotent"
    master_user_secret = [{
      secret_arn    = "arn:aws:secretsmanager:eu-north-1:123456789012:secret:rds!db-1-AbCdEf"
      secret_status = "active"
      kms_key_id    = "arn:aws:kms:eu-north-1:123456789012:key/key"
    }]
  }
}

mock_resource "aws_secretsmanager_secret" {
  defaults = {
    arn = "arn:aws:secretsmanager:eu-north-1:123456789012:secret:secret-AbCdEf"
  }
}

mock_resource "aws_sns_topic" {
  defaults = {
    arn = "arn:aws:sns:eu-north-1:123456789012:omnipotent-prod-alarms"
  }
}

mock_resource "aws_lb" {
  defaults = {
    arn        = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:loadbalancer/app/api/1"
    arn_suffix = "app/api/1"
    dns_name   = "api-1.eu-north-1.elb.amazonaws.com"
  }
}

mock_resource "aws_lb_target_group" {
  defaults = {
    arn        = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:targetgroup/api/1"
    arn_suffix = "targetgroup/api/1"
  }
}

mock_resource "aws_lb_listener" {
  defaults = {
    arn = "arn:aws:elasticloadbalancing:eu-north-1:123456789012:listener/app/api/1/2"
  }
}

mock_resource "aws_iam_role" {
  defaults = {
    arn = "arn:aws:iam::123456789012:role/role"
  }
}

mock_resource "aws_iam_openid_connect_provider" {
  defaults = {
    arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  }
}

mock_resource "aws_ecr_repository" {
  defaults = {
    arn            = "arn:aws:ecr:eu-north-1:123456789012:repository/omnipotent-backend"
    repository_url = "123456789012.dkr.ecr.eu-north-1.amazonaws.com/omnipotent-backend"
  }
}

mock_resource "aws_s3_bucket" {
  defaults = {
    arn                         = "arn:aws:s3:::bucket"
    bucket_regional_domain_name = "bucket.s3.eu-north-1.amazonaws.com"
  }
}

mock_resource "aws_cloudfront_distribution" {
  defaults = {
    id          = "E123"
    arn         = "arn:aws:cloudfront::123456789012:distribution/E123"
    domain_name = "d123.cloudfront.net"
  }
}

mock_resource "aws_cloudwatch_log_group" {
  defaults = {
    arn = "arn:aws:logs:eu-north-1:123456789012:log-group:group"
  }
}

mock_resource "aws_sfn_state_machine" {
  defaults = {
    arn = "arn:aws:states:eu-north-1:123456789012:stateMachine:machine"
  }
}

mock_resource "aws_cloudwatch_event_rule" {
  defaults = {
    arn = "arn:aws:events:eu-north-1:123456789012:rule/rule"
  }
}

mock_resource "aws_cloudfront_function" {
  defaults = {
    arn = "arn:aws:cloudfront::123456789012:function/omnipotent-prod-front-spa-routes"
  }
}

mock_resource "aws_wafv2_web_acl" {
  defaults = {
    arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/omnipotent-prod/abc"
  }
}

mock_data "aws_elb_service_account" {
  defaults = {
    arn = "arn:aws:iam::897822967062:root"
  }
}

mock_resource "aws_eip" {
  defaults = {
    public_ip = "203.0.113.10"
  }
}
