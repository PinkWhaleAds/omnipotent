output "cluster_name" {
  description = "Name of the cluster."
  value       = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  description = "ARN of the cluster."
  value       = aws_ecs_cluster.this.arn
}

output "tasks_security_group_id" {
  description = "Security group shared by the tasks of the application."
  value       = aws_security_group.tasks.id
}
