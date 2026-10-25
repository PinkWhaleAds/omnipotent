output "execution_role_arn" {
  description = "ARN of the task execution role."
  value       = aws_iam_role.execution.arn
}

output "task_role_arn" {
  description = "ARN of the task role (the application's permissions)."
  value       = aws_iam_role.task.arn
}

output "migrate_task_role_arn" {
  description = "ARN of the task role of the migration task (no permission)."
  value       = aws_iam_role.migrate.arn
}
