variable "path" {
  description = "SSM path of the parameters (e.g. /omnipotent/prod/deploy), without trailing slash."
  type        = string

  validation {
    condition     = startswith(var.path, "/") && !endswith(var.path, "/")
    error_message = "path must start with / and must not end with /."
  }
}

variable "parameters" {
  description = "Parameters to write: name (lowercase, dashes) => value. The deploy workflow reads them as NAME_IN_UPPER_SNAKE_CASE environment variables."
  type        = map(string)

  validation {
    condition     = alltrue([for name, value in var.parameters : can(regex("^[a-z0-9-]+$", name)) && value != ""])
    error_message = "Parameter names use lowercase letters, digits and dashes, and no value may be empty (SSM refuses it)."
  }
}
