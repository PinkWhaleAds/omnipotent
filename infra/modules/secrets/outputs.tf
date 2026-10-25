output "arns" {
  description = "ARN of each secret, by the key it was declared under."
  value       = { for key, secret in aws_secretsmanager_secret.this : key => secret.arn }
}

output "names" {
  description = "Name of each secret, by the key it was declared under."
  value       = { for key, secret in aws_secretsmanager_secret.this : key => secret.name }
}
