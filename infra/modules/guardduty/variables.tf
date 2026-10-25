variable "name" {
  description = "Prefix of the resource names (e.g. omnipotent-prod)."
  type        = string
}

variable "alarm_topic_arn" {
  description = "SNS topic of the alarms: the findings are e-mailed through it (its policy must let EventBridge publish)."
  type        = string
}

variable "s3_protection" {
  description = "S3 Protection: GuardDuty analyses the S3 data events of the account's buckets (reads and writes of the backend's files, the logs)."
  type        = bool
  default     = true
}

variable "rds_protection" {
  description = "RDS Protection (login activity): GuardDuty profiles the sign-ins to the PostgreSQL instance (brute force, unusual clients). Billed per vCPU of the instance."
  type        = bool
  default     = true
}

variable "runtime_monitoring" {
  description = "Runtime Monitoring of the Fargate tasks: GuardDuty adds its agent as a sidecar of every task started afterwards (processes, files, network inside the containers). Billed per vCPU of the tasks; the agent takes up to 128 MB of each task's memory."
  type        = bool
  default     = false
}

variable "finding_publishing_frequency" {
  description = "How often GuardDuty publishes the UPDATES of a finding that keeps happening (a new finding is always published within about 5 minutes): FIFTEEN_MINUTES, ONE_HOUR or SIX_HOURS. Each update of a finding above the alert severity is an e-mail."
  type        = string
  default     = "SIX_HOURS"

  validation {
    condition     = contains(["FIFTEEN_MINUTES", "ONE_HOUR", "SIX_HOURS"], var.finding_publishing_frequency)
    error_message = "finding_publishing_frequency is FIFTEEN_MINUTES, ONE_HOUR or SIX_HOURS."
  }
}

variable "alert_min_severity" {
  description = "Lowest severity of the findings e-mailed (GuardDuty's scale: low 1 to 3.9, medium 4 to 6.9, high 7 to 8.9, critical 9 to 10). The others stay in the console."
  type        = number
  default     = 4

  validation {
    condition     = var.alert_min_severity >= 1 && var.alert_min_severity <= 10
    error_message = "alert_min_severity is between 1 and 10."
  }
}
