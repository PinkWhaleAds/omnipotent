variable "name" {
  description = "Name of the cluster (also the prefix of the tasks' security group)."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC of the tasks."
  type        = string
}

variable "container_insights" {
  description = "Container Insights: enabled (task and service metrics, needed by the running-task alarms), enhanced or disabled."
  type        = string
  default     = "enabled"

  validation {
    condition     = contains(["enabled", "enhanced", "disabled"], var.container_insights)
    error_message = "container_insights must be enabled, enhanced or disabled."
  }
}
