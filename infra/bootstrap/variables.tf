variable "region" {
  description = "AWS region of the state bucket (the stacks may live in other regions)."
  type        = string
  default     = "eu-north-1"
}

variable "project" {
  description = "Project name, used in resource names and tags."
  type        = string
  default     = "omnipotent"
}

variable "state_bucket_name" {
  description = "Name of the state bucket. Empty: <project>-tfstate-<account id>, unique worldwide."
  type        = string
  default     = ""
}

variable "noncurrent_version_retention_days" {
  description = "Days an overwritten state version is kept (to recover from a bad apply)."
  type        = number
  default     = 90
}
