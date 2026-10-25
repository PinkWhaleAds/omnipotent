variable "prefix" {
  description = "Prefix of the secret names (SECRETS_PREFIX), e.g. omnipotent/prod."
  type        = string
}

variable "secrets" {
  description = <<-EOT
    The containers to create, by key: the name under `prefix` and what the value holds, for whoever writes it.
    Empty in the socle; each phase adds what its credentials need.
  EOT
  type = map(object({
    name        = string
    description = string
  }))
  default = {}
}

variable "recovery_window_in_days" {
  description = "Days a deleted secret can still be restored."
  type        = number
  default     = 30
}
