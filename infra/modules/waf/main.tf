# AWS WAF in front of the CloudFront distributions (the API, and the tracking host with a custom domain).
# A web ACL of scope CLOUDFRONT lives in us-east-1: the caller passes a provider of that region. Requests are checked
# at the edge, before the cache and before anything reaches the load balancer, the tasks or the database.
#
# Rules, in order:
#   1. public-rate-per-ip  the anonymous routes (the probes, /status, the OAuth metadata): a tighter
#                          per-IP limit, since a flood there costs database connections without any sign-in;
#   2. rate-per-ip         every request: per-IP limit over the evaluation window;
#   3. known-bad-inputs    AWS managed rules: Log4j, Java deserialization, exploitable paths, localhost Host...;
#   4. common              AWS managed core rule set (OWASP-style), with the rules that would refuse legitimate
#                          API bodies only counted (see var.common_rules_count_only).
# Over a limit, a client gets 429 with Retry-After until its rate falls back under it.
resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  description = "Omnipotent edge: per-IP rate limits and AWS managed rules"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  custom_response_body {
    key          = "rate-limited"
    content_type = "APPLICATION_JSON"
    # The shape of the API's errors (code translated by the app).
    content = jsonencode({
      statusCode = 429
      error      = "Too Many Requests"
      code       = "rate_limited"
      params     = {}
      message    = "Too many requests from this address, retry later"
    })
  }

  rule {
    name     = "public-rate-per-ip"
    priority = 0

    action {
      block {
        custom_response {
          response_code            = 429
          custom_response_body_key = "rate-limited"

          response_header {
            name  = "retry-after"
            value = tostring(var.rate_limit_window)
          }

          # Readable by the app's script (no data in it); the API's own responses keep their CORS headers.
          response_header {
            name  = "access-control-allow-origin"
            value = "*"
          }

          # Without it the browser hides Retry-After from the app, which then cannot say how long to wait.
          response_header {
            name  = "access-control-expose-headers"
            value = "retry-after"
          }
        }
      }
    }

    statement {
      rate_based_statement {
        limit                 = var.public_rate_limit
        evaluation_window_sec = var.rate_limit_window
        aggregate_key_type    = "IP"

        scope_down_statement {
          or_statement {
            dynamic "statement" {
              for_each = var.public_path_prefixes

              content {
                byte_match_statement {
                  search_string         = statement.value
                  positional_constraint = "STARTS_WITH"

                  field_to_match {
                    uri_path {}
                  }

                  text_transformation {
                    priority = 0
                    type     = "NONE"
                  }
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-public-rate-per-ip"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-per-ip"
    priority = 1

    action {
      block {
        custom_response {
          response_code            = 429
          custom_response_body_key = "rate-limited"

          response_header {
            name  = "retry-after"
            value = tostring(var.rate_limit_window)
          }

          # Readable by the app's script (no data in it); the API's own responses keep their CORS headers.
          response_header {
            name  = "access-control-allow-origin"
            value = "*"
          }

          # Without it the browser hides Retry-After from the app, which then cannot say how long to wait.
          response_header {
            name  = "access-control-expose-headers"
            value = "retry-after"
          }
        }
      }
    }

    statement {
      rate_based_statement {
        limit                 = var.rate_limit
        evaluation_window_sec = var.rate_limit_window
        aggregate_key_type    = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate-per-ip"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "common"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"

        # Counted, not blocked: they would refuse legitimate requests (see var.common_rules_count_only).
        dynamic "rule_action_override" {
          for_each = var.common_rules_count_only

          content {
            name = rule_action_override.value

            action_to_use {
              count {}
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
}

# Optional (paid: CloudWatch Logs ingestion): the requests WAF blocked or counted, never the allowed ones, with
# the Authorization header redacted. The log group name must start with aws-waf-logs-.
resource "aws_cloudwatch_log_group" "this" {
  count = var.logging_enabled ? 1 : 0

  name              = "aws-waf-logs-${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  count = var.logging_enabled ? 1 : 0

  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.this[0].arn]

  redacted_fields {
    single_header {
      name = "authorization"
    }
  }

  logging_filter {
    default_behavior = "DROP"

    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"

      condition {
        action_condition {
          action = "BLOCK"
        }
      }

      condition {
        action_condition {
          action = "COUNT"
        }
      }
    }
  }
}
