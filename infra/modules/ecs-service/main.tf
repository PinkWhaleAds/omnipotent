data "aws_region" "current" {}

locals {
  container_name = "app"

  container = {
    name      = local.container_name
    image     = var.image
    essential = true
    command   = var.command

    portMappings = var.container_port == null ? [] : [{
      containerPort = var.container_port
      hostPort      = var.container_port
      protocol      = "tcp"
    }]

    environment = [
      for key in sort(keys(var.environment)) : { name = key, value = var.environment[key] }
      if var.environment[key] != ""
    ]
    secrets = [for key in sort(keys(var.secrets)) : { name = key, valueFrom = var.secrets[key] }]

    healthCheck = var.health_check_command == null ? null : {
      command     = var.health_check_command
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }

    # The image runs node as PID 1 so that it receives SIGTERM itself.
    stopTimeout = var.stop_timeout

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.this.name
        awslogs-region        = data.aws_region.current.region
        awslogs-stream-prefix = var.name
        mode                  = "non-blocking"
        max-buffer-size       = "25m"
      }
    }

    mountPoints    = []
    volumesFrom    = []
    systemControls = []
  }
}

resource "aws_cloudwatch_log_group" "this" {
  name              = var.log_group_name
  retention_in_days = var.log_retention_days
}

# Terraform owns the shape of the task (environment, secrets, roles, sizes). The deploy workflow
# registers the next revisions from the latest one with only the image changed, so a change made here
# reaches the running tasks at the next deploy. Old revisions are kept (skip_destroy) for rollbacks.
resource "aws_ecs_task_definition" "this" {
  family                   = var.family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  task_role_arn            = var.task_role_arn
  execution_role_arn       = var.execution_role_arn
  skip_destroy             = true

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([local.container])
}

resource "aws_ecs_service" "this" {
  count = var.create_service ? 1 : 0

  name             = var.name
  cluster          = var.cluster_arn
  task_definition  = aws_ecs_task_definition.this.arn
  desired_count    = var.desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = var.assign_public_ip
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn == null ? [] : [var.target_group_arn]

    content {
      target_group_arn = load_balancer.value
      container_name   = local.container_name
      container_port   = var.container_port
    }
  }

  health_check_grace_period_seconds = var.target_group_arn == null ? null : var.health_check_grace_period_seconds

  # Rolling deploy: new tasks start and turn healthy before the old ones stop. A deployment whose tasks
  # never turn healthy is stopped and rolled back to the previous revision.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  enable_ecs_managed_tags = true
  propagate_tags          = "SERVICE"
  wait_for_steady_state   = false

  lifecycle {
    # task_definition: the deploy workflow registers a revision per commit and points the service at it;
    # Terraform must not move the service back to the revision it registered (and its first image).
    # desired_count: the autoscaling changes it; Terraform must not reset it at each apply.
    ignore_changes = [task_definition, desired_count]
  }
}

resource "aws_appautoscaling_target" "this" {
  count = var.create_service && var.autoscaling != null ? 1 : 0

  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${split("/", var.cluster_arn)[1]}/${aws_ecs_service.this[0].name}"
  min_capacity       = var.autoscaling.min_count
  max_capacity       = var.autoscaling.max_count
}

resource "aws_appautoscaling_policy" "cpu" {
  count = var.create_service && var.autoscaling != null ? 1 : 0

  name               = "${var.family}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.this[0].service_namespace
  scalable_dimension = aws_appautoscaling_target.this[0].scalable_dimension
  resource_id        = aws_appautoscaling_target.this[0].resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling.cpu_target_percent
    scale_out_cooldown = 60
    scale_in_cooldown  = 300

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
