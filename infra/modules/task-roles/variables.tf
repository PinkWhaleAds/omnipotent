variable "name" {
  description = "Prefix of the role names (e.g. omnipotent-prod)."
  type        = string
}

variable "ecr_repository_arn" {
  description = "Repository the tasks pull their image from."
  type        = string
}

variable "sidecar_repository_arns" {
  description = "Other repositories the execution role may pull from: images AWS adds to the tasks (GuardDuty's Runtime Monitoring agent). Empty: only ecr_repository_arn."
  type        = list(string)
  default     = []
}

variable "log_group_prefix" {
  description = "Prefix of the CloudWatch log groups of the tasks (e.g. /ecs/omnipotent-prod/)."
  type        = string
}

variable "injected_secret_arns" {
  description = "Secrets ECS injects into the containers as environment variables (read by the execution role at start)."
  type        = list(string)
}

variable "assets_bucket_arn" {
  description = "Bucket of the files the backend keeps, read and written by it."
  type        = string
}

variable "secrets_prefix" {
  description = "Prefix of the secrets of the backend (SECRETS_PREFIX), e.g. omnipotent/prod: it creates and deletes those of the organizations under <prefix>/<organization id>/."
  type        = string
}

variable "read_only_secret_arns" {
  description = "Secrets filled by hand that the backend only reads (a platform service account, an API key)."
  type        = list(string)
}

variable "app_written_secret_arns" {
  description = "Secrets created by Terraform whose value the backend writes (OAuth tokens, a signing key)."
  type        = list(string)
}

variable "db_connect_arns" {
  description = "rds-db:connect ARNs of the database users the backend may sign in as with IAM tokens (empty: none)."
  type        = list(string)
  default     = []
}
