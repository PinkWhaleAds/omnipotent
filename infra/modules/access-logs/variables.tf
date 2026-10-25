variable "bucket_name" {
  description = "Name of the access logs bucket (unique worldwide)."
  type        = string
}

variable "retention_days" {
  description = "Days the access logs are kept."
  type        = number
  default     = 90
}

variable "force_destroy" {
  description = "Let terraform destroy delete the bucket with its objects (the logs): a disposable environment only."
  type        = bool
  default     = false
}
