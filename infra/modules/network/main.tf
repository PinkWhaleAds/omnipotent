data "aws_availability_zones" "available" {
  state = "available"

  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_region" "current" {}

locals {
  azs      = slice(data.aws_availability_zones.available.names, 0, var.az_count)
  nat_azs  = !var.nat_gateway_enabled ? [] : var.nat_gateway_per_az ? local.azs : [local.azs[0]]
  az_index = { for index, az in local.azs : az => index }
}

resource "aws_vpc" "this" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = var.name }
}

# The default security group of the VPC allows nothing: every resource gets its own group.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name}-default-unused" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = { Name = var.name }
}

# Public subnets (/24): the NAT gateways; without NAT gateway, the ECS tasks (each with its public IP).
resource "aws_subnet" "public" {
  for_each = local.az_index

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.cidr_block, 8, each.value)

  tags = { Name = "${var.name}-public-${each.key}", Tier = "public" }
}

# Private subnets (/20): the load balancer, the database and, with a NAT gateway, the ECS tasks. No public IP; internet
# through the NAT gateway, or none at all without it.
resource "aws_subnet" "private" {
  for_each = local.az_index

  vpc_id            = aws_vpc.this.id
  availability_zone = each.key
  cidr_block        = cidrsubnet(var.cidr_block, 4, each.value + 1)

  tags = { Name = "${var.name}-private-${each.key}", Tier = "private" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name}-public" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this.id
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# The NAT gateway's Elastic IP is the fixed egress address of the backend (platform allow lists, SFTP).
resource "aws_eip" "nat" {
  for_each = toset(local.nat_azs)

  domain = "vpc"

  tags = { Name = "${var.name}-nat-${each.key}" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_nat_gateway" "this" {
  for_each = toset(local.nat_azs)

  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.public[each.key].id

  tags = { Name = "${var.name}-${each.key}" }

  depends_on = [aws_internet_gateway.this]
}

resource "aws_route_table" "private" {
  for_each = local.az_index

  vpc_id = aws_vpc.this.id

  tags = { Name = "${var.name}-private-${each.key}" }
}

resource "aws_route" "private_nat" {
  for_each = var.nat_gateway_enabled ? local.az_index : {}

  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = var.nat_gateway_per_az ? aws_nat_gateway.this[each.key].id : aws_nat_gateway.this[local.azs[0]].id
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private[each.key].id
}

# Free gateway endpoint: S3 traffic (the backend's files, ECR image layers) skips the NAT and its data fee.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [for table in aws_route_table.private : table.id]

  tags = { Name = "${var.name}-s3" }
}

# Flow logs of the whole VPC (every interface: load balancer, NAT gateway, tasks, database, endpoints), accepted and
# rejected traffic, to the access logs bucket (whose lifecycle expires them). The cheapest
# format: AWS's default fields (version 2), plain text compressed by AWS (no Parquet conversion fee), one record per
# flow and 10-minute window. Read them with Athena or by download.
resource "aws_flow_log" "this" {
  count = var.enable_flow_logs ? 1 : 0

  vpc_id                   = aws_vpc.this.id
  traffic_type             = "ALL"
  log_destination_type     = "s3"
  log_destination          = var.flow_logs_destination_arn
  max_aggregation_interval = 600

  destination_options {
    file_format                = "plain-text"
    hive_compatible_partitions = false
    per_hour_partition         = false
  }

  tags = { Name = var.name }
}
