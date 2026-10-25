variable "name" {
  description = "Prefix of the role name (e.g. omnipotent-prod)."
  type        = string
}

variable "create_provider" {
  description = "Create the account's GitHub OIDC provider. False when another stack of the same account (e.g. staging) already created it."
  type        = bool
  default     = true
}

variable "subjects" {
  description = "Exact `sub` claims allowed to assume the deploy role (see the subject template in infra/README.md)."
  type        = list(string)
}

variable "ecr_repository_arn" {
  description = "Repository the workflow pushes the backend image to."
  type        = string
}

variable "cluster_arn" {
  description = "ARN of the ECS cluster."
  type        = string
}

variable "service_arns" {
  description = "ECS services the workflow updates."
  type        = list(string)
}

variable "migration_task_family" {
  description = "Family of the migration task definition the workflow runs."
  type        = string
}

variable "migration_log_group_arn" {
  description = "Log group of the migration task (the workflow prints its logs)."
  type        = string
}

variable "passable_role_arns" {
  description = "Roles the workflow may hand to ECS in the task definitions it registers (task and execution roles)."
  type        = list(string)
}

variable "deploy_parameters_path" {
  description = "SSM path of the parameters the workflow reads (e.g. /omnipotent/prod/deploy)."
  type        = string
}
