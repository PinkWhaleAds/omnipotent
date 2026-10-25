output "dns_name" {
  description = "DNS name of the load balancer (the CloudFront origin)."
  value       = aws_lb.this.dns_name
}

output "arn_suffix" {
  description = "ARN suffix of the load balancer (CloudWatch dimension LoadBalancer)."
  value       = aws_lb.this.arn_suffix
}

output "target_group_arn" {
  description = "ARN of the API target group."
  value       = aws_lb_target_group.api.arn
}

output "target_group_arn_suffix" {
  description = "ARN suffix of the API target group (CloudWatch dimension TargetGroup)."
  value       = aws_lb_target_group.api.arn_suffix
}

output "origin_header_name" {
  description = "Name of the secret origin header."
  value       = var.origin_header_name
}

output "origin_header_value" {
  description = "Value of the secret origin header (CloudFront sends it, the load balancer checks it)."
  value       = random_password.origin_verify.result
  sensitive   = true
}

output "arn" {
  description = "ARN of the load balancer, the target of the CloudFront VPC origin."
  value       = aws_lb.this.arn
}
