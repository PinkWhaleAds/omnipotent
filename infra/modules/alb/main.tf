# The public entry of the API is CloudFront (module api-edge), which reaches this load balancer as a VPC
# origin: the load balancer is internal, in the private subnets, with no public address. It only accepts
# CloudFront's origin-facing addresses (managed prefix list, which covers the VPC origin's service network
# interfaces) and only forwards requests that carry the secret origin header: anything else gets a 403.
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# Not a user secret: a shared value between CloudFront and the ALB, generated here and kept in the state.
resource "random_password" "origin_verify" {
  length  = 48
  special = false
}

resource "aws_security_group" "this" {
  name        = "${var.name}-alb"
  description = "Internal API load balancer: HTTP from CloudFront (VPC origin) only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "cloudfront" {
  security_group_id = aws_security_group.this.id
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  description       = "HTTP from CloudFront origin-facing servers"
}

resource "aws_vpc_security_group_egress_rule" "targets" {
  security_group_id            = aws_security_group.this.id
  referenced_security_group_id = var.target_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = var.target_port
  to_port                      = var.target_port
  description                  = "To the API tasks"
}

resource "aws_vpc_security_group_ingress_rule" "targets_from_alb" {
  security_group_id            = var.target_security_group_id
  referenced_security_group_id = aws_security_group.this.id
  ip_protocol                  = "tcp"
  from_port                    = var.target_port
  to_port                      = var.target_port
  description                  = "From the API load balancer"
}

resource "aws_lb" "this" {
  name               = substr("${var.name}-api", 0, 32)
  load_balancer_type = "application"
  internal           = true
  security_groups    = [aws_security_group.this.id]
  subnets            = var.subnet_ids

  idle_timeout               = var.idle_timeout
  drop_invalid_header_fields = true
  enable_deletion_protection = false

  dynamic "access_logs" {
    for_each = var.access_logs_bucket == null ? [] : [var.access_logs_bucket]

    content {
      bucket  = access_logs.value
      prefix  = var.access_logs_prefix
      enabled = true
    }
  }
}

resource "aws_lb_target_group" "api" {
  name                 = substr("${var.name}-api", 0, 32)
  vpc_id               = var.vpc_id
  target_type          = "ip"
  protocol             = "HTTP"
  port                 = var.target_port
  deregistration_delay = var.deregistration_delay

  health_check {
    path                = var.health_check_path
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Forbidden"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 1

  condition {
    http_header {
      http_header_name = var.origin_header_name
      values           = [random_password.origin_verify.result]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
