variable "bucket_name" {
  description = "Name of the bucket of the files the backend keeps (unique worldwide)."
  type        = string
}

variable "noncurrent_version_retention_days" {
  description = "Days an overwritten or deleted image version is kept."
  type        = number
  default     = 30
}

variable "cors_allowed_origins" {
  description = "Web origins allowed to read the images with fetch() through their presigned URLs (an <img> needs no CORS)."
  type        = list(string)
  default     = []
}

variable "force_destroy" {
  description = "Let terraform destroy delete the bucket with its objects: a disposable environment only."
  type        = bool
  default     = false
}
