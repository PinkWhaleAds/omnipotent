resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = var.container_insights
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# One security group for every task of the application (API, worker, migrations): the load balancer
# and the database grant access to it. Outbound traffic goes anywhere through the NAT (platform APIs,
# Auth0, the advertising platforms, AWS APIs).
resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "ECS tasks of omnipotent"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.name}-tasks" }
}

resource "aws_vpc_security_group_egress_rule" "tasks_all" {
  security_group_id = aws_security_group.tasks.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  description       = "Outbound to the internet (NAT) and AWS services"
}
