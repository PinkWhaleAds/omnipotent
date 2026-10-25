output "service_name" {
  description = "Name of the service (null when create_service is false)."
  value       = var.create_service ? aws_ecs_service.this[0].name : null
}

output "service_arn" {
  description = "ARN of the service (null when create_service is false)."
  value       = var.create_service ? aws_ecs_service.this[0].id : null
}

output "task_family" {
  description = "Family of the task definition."
  value       = aws_ecs_task_definition.this.family
}

output "task_definition_arn" {
  description = "ARN of the revision Terraform registered (not necessarily the one running)."
  value       = aws_ecs_task_definition.this.arn
}

output "log_group_name" {
  description = "CloudWatch log group of the container."
  value       = aws_cloudwatch_log_group.this.name
}

output "log_group_arn" {
  description = "ARN of the CloudWatch log group."
  value       = aws_cloudwatch_log_group.this.arn
}

output "container_name" {
  description = "Name of the container in the task definition."
  value       = local.container_name
}
