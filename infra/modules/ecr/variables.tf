variable "name" {
  description = "Name of the repository."
  type        = string
}

variable "keep_images" {
  description = "Number of images kept (the oldest beyond it are deleted). A rollback can only go back this far."
  type        = number
  default     = 30
}

variable "untagged_retention_days" {
  description = "Days an untagged image (an interrupted push) is kept."
  type        = number
  default     = 7
}

variable "force_delete" {
  description = "Let terraform destroy delete the repository with its images: a disposable environment only."
  type        = bool
  default     = false
}
