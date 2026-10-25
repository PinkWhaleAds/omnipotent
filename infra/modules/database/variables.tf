variable "identifier" {
  description = "Identifier of the RDS instance (also the prefix of its related resources)."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets of the instance (at least two zones)."
  type        = list(string)
}

variable "client_security_group_ids" {
  description = "Security groups allowed to connect on the PostgreSQL port (the ECS tasks)."
  type        = list(string)
}

variable "engine_version" {
  description = "PostgreSQL major version (RDS picks the latest minor and upgrades minors automatically)."
  type        = string
  default     = "17"
}

variable "instance_class" {
  description = "Instance class (Graviton)."
  type        = string
  default     = "db.t4g.small"
}

variable "allocated_storage" {
  description = "Initial storage, in GB (gp3)."
  type        = number
  default     = 20
}

variable "max_allocated_storage" {
  description = "Storage autoscaling ceiling, in GB."
  type        = number
  default     = 100
}

variable "db_name" {
  description = "Name of the database (DB_NAME)."
  type        = string
  default     = "omnipotent"
}

variable "username" {
  description = "Master user name (DB_USER). Its password is generated and kept by RDS in Secrets Manager."
  type        = string
  default     = "omnipotent"
}

variable "multi_az" {
  description = "Standby replica in a second zone (doubles the instance cost)."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Days of automated backups (point-in-time recovery)."
  type        = number
  default     = 7
}

variable "backup_window" {
  description = "Daily backup window, UTC."
  type        = string
  default     = "01:00-02:00"
}

variable "maintenance_window" {
  description = "Weekly maintenance window, UTC."
  type        = string
  default     = "sun:02:30-sun:03:30"
}

variable "ca_cert_identifier" {
  description = "Certificate authority of the server certificate (in the RDS global bundle baked into the backend image)."
  type        = string
  default     = "rds-ca-rsa2048-g1"
}

variable "deletion_protection" {
  description = "Refuse to delete the instance (turn off explicitly before a destroy)."
  type        = bool
  default     = true
}

variable "skip_final_snapshot" {
  description = "Delete the instance without a final snapshot (a disposable environment; otherwise <identifier>-final is kept, and a second destroy would collide with it)."
  type        = bool
  default     = false
}

variable "delete_automated_backups" {
  description = "Delete the automated backups with the instance (otherwise they are kept until their retention ends)."
  type        = bool
  default     = false
}

variable "apply_immediately" {
  description = "Apply modifications now instead of during the maintenance window."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Retention of the PostgreSQL logs exported to CloudWatch, in days."
  type        = number
  default     = 30
}

variable "password_rotation_schedule" {
  description = "When RDS rotates the master password (Secrets Manager schedule expression). Tasks read it at start: db-rotation-restart redeploys them after each rotation."
  type        = string
  default     = "cron(0 3 1 * ? *)"
}

variable "iam_authentication" {
  description = "Accept RDS IAM authentication tokens (the application role signs in with its task role)."
  type        = bool
  default     = true
}
