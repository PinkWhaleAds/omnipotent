output "vpc_id" {
  description = "ID of the VPC."
  value       = aws_vpc.this.id
}

output "vpc_cidr_block" {
  description = "CIDR block of the VPC."
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "IDs of the public subnets (load balancer, NAT)."
  value       = [for az in local.azs : aws_subnet.public[az].id]
}

output "private_subnet_ids" {
  description = "IDs of the private subnets (ECS tasks, database)."
  value       = [for az in local.azs : aws_subnet.private[az].id]
}

output "nat_public_ips" {
  description = "Public IPs of the NAT gateways: the egress addresses of the backend (empty without NAT gateway)."
  value       = [for az in local.nat_azs : aws_eip.nat[az].public_ip]
}
