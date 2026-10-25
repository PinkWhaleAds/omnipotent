variable "name" {
  description = "Short name of the process (api, worker, migrate): service name and log stream prefix."
  type        = string
}

variable "family" {
  description = "Family of the task definition (e.g. omnipotent-prod-api)."
  type        = string
}

variable "create_service" {
  description = "Create an ECS service. False for a one-off task (the migrations) that only needs its task definition."
  type        = bool
  default     = true
}

variable "cluster_arn" {
  description = "ARN of the ECS cluster."
  type        = string
}

variable "image" {
  description = "Image of the FIRST revision only. The deploy workflow registers the next revisions with the image of the commit it deploys."
  type        = string
}

variable "command" {
  description = "Command overriding the image's CMD (null keeps it)."
  type        = list(string)
  default     = null
}

variable "cpu" {
  description = "Task CPU units (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Task memory, in MiB."
  type        = number
  default     = 1024
}

variable "container_port" {
  description = "Port the container listens on (null: none exposed)."
  type        = number
  default     = null
}

variable "environment" {
  description = "Environment variables of the container. Empty values are left out (the backend's config ignores them anyway)."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Environment variables read from Secrets Manager at start: name => valueFrom (secret ARN, optionally :json-key::)."
  type        = map(string)
  default     = {}
}

variable "task_role_arn" {
  description = "Role of the application."
  type        = string
}

variable "execution_role_arn" {
  description = "Role of the ECS agent (image pull, logs, injected secrets)."
  type        = string
}

variable "log_group_name" {
  description = "CloudWatch log group of the container."
  type        = string
}

variable "log_retention_days" {
  description = "Retention of the logs, in days."
  type        = number
  default     = 30
}

variable "health_check_command" {
  description = "Container health check (ECS replaces an unhealthy task). Null: none."
  type        = list(string)
  default     = null
}

variable "stop_timeout" {
  description = "Seconds between SIGTERM and SIGKILL (Fargate maximum 120). Keep it above APP_SHUTDOWN_TIMEOUT."
  type        = number
  default     = 30
}

variable "subnet_ids" {
  description = "Subnets of the tasks: private behind a NAT gateway, or public with assign_public_ip."
  type        = list(string)
  default     = []
}

variable "assign_public_ip" {
  description = "Give each task a public IP (tasks in public subnets that reach the internet without a NAT gateway; their security group still refuses any inbound connection it does not allow)."
  type        = bool
  default     = false
}

variable "security_group_ids" {
  description = "Security groups of the tasks."
  type        = list(string)
  default     = []
}

variable "desired_count" {
  description = "Number of tasks at creation. Afterwards the autoscaling (or the console) owns it: Terraform ignores it."
  type        = number
  default     = 1
}

variable "target_group_arn" {
  description = "Target group the tasks register into (null: no load balancer)."
  type        = string
  default     = null
}

variable "health_check_grace_period_seconds" {
  description = "Seconds the load balancer health checks are ignored after a task starts."
  type        = number
  default     = 60
}

variable "autoscaling" {
  description = "Target tracking on the average CPU (null: no autoscaling)."
  type = object({
    min_count          = number
    max_count          = number
    cpu_target_percent = number
  })
  default = null
}
