variable "name" {
  description = "Prefix of the resource names (e.g. omnipotent-prod)."
  type        = string
}

variable "alarm_email" {
  description = "E-mail address subscribed to the alarms (AWS sends a confirmation link first). Null: no subscription."
  type        = string
  default     = null
}

variable "alb_arn_suffix" {
  description = "ARN suffix of the API load balancer."
  type        = string
}

variable "target_group_arn_suffix" {
  description = "ARN suffix of the API target group."
  type        = string
}

variable "cluster_name" {
  description = "Name of the ECS cluster."
  type        = string
}

variable "service_names" {
  description = "ECS services that must always run at least one task."
  type        = list(string)
}

variable "container_insights_enabled" {
  description = "Whether Container Insights is on: the running-task alarms read its RunningTaskCount metric and are only created with it."
  type        = bool
}

variable "db_instance_identifier" {
  description = "Identifier of the RDS instance."
  type        = string
}

variable "error_rate_threshold_percent" {
  description = "Share of 5xx answers (load balancer or backend) that raises an alarm, in percent."
  type        = number
  default     = 5
}

variable "error_rate_min_requests" {
  description = "Below this many requests in 5 minutes the error rate is not evaluated (a single failure would be 100 %)."
  type        = number
  default     = 20
}

variable "db_cpu_threshold_percent" {
  description = "Average database CPU that raises an alarm, in percent."
  type        = number
  default     = 80
}

variable "db_free_storage_threshold_bytes" {
  description = "Free database storage under which an alarm is raised, in bytes (storage autoscaling should step in before)."
  type        = number
  default     = 2147483648
}

variable "db_free_memory_threshold_bytes" {
  description = "Freeable database memory under which an alarm is raised, in bytes."
  type        = number
  default     = 134217728
}

variable "monthly_budget_usd" {
  description = "Monthly AWS budget of the whole account, in USD: notified at 80 % of the actual and 100 % of the forecast cost. Null: no budget."
  type        = number
  default     = null
}
