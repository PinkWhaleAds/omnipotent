variable "name" {
  description = "Name of the trail (also the prefix of its bucket)."
  type        = string
}

variable "bucket_name" {
  description = "Name of the bucket of the trail logs (unique worldwide)."
  type        = string
}

variable "retention_days" {
  description = "Days the trail logs are kept."
  type        = number
  default     = 365
}

variable "force_destroy" {
  description = "Let terraform destroy delete the bucket with its objects (the trail logs): a disposable environment only."
  type        = bool
  default     = false
}
