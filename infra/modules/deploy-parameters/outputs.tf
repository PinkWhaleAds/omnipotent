output "path" {
  description = "SSM path of the parameters."
  value       = var.path
}

output "names" {
  description = "Full names of the parameters."
  value       = sort([for parameter in aws_ssm_parameter.this : parameter.name])
}
