variable "name" {
  description = "Prefix of the resource names (e.g. omnipotent-prod)."
  type        = string
}

variable "secret_arn" {
  description = "ARN of the RDS-managed secret of the master password."
  type        = string
}

variable "cluster_arn" {
  description = "ARN of the ECS cluster."
  type        = string
}

variable "services" {
  description = "Services to redeploy after a rotation: name => ARN."
  type        = map(string)
}

variable "alarm_topic_arn" {
  description = "SNS topic notified when a redeploy fails."
  type        = string
}
