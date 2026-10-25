output "identifier" {
  description = "Identifier of the instance (CloudWatch dimension DBInstanceIdentifier)."
  value       = aws_db_instance.this.identifier
}

output "address" {
  description = "Host name of the instance (DB_HOST); it matches the server certificate."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "Port of the instance (DB_PORT)."
  value       = aws_db_instance.this.port
}

output "db_name" {
  description = "Name of the database (DB_NAME)."
  value       = aws_db_instance.this.db_name
}

output "username" {
  description = "Master user name (DB_USER)."
  value       = aws_db_instance.this.username
}

output "master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the master credentials (JSON: username, password), managed by RDS."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "security_group_id" {
  description = "Security group of the instance."
  value       = aws_security_group.this.id
}

output "resource_id" {
  description = "Resource id of the instance (db-XXXX), in the ARN of rds-db:connect: arn:aws:rds-db:<region>:<account>:dbuser:<resource id>/<user>."
  value       = aws_db_instance.this.resource_id
}
