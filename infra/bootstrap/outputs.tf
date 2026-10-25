output "state_bucket" {
  description = "Name of the state bucket: pass it to `terraform init -backend-config=\"bucket=...\"` in envs/*."
  value       = aws_s3_bucket.state.bucket
}

output "state_bucket_region" {
  description = "Region of the state bucket (the `region` of the backend blocks)."
  value       = var.region
}

output "init_command" {
  description = "Command initializing the environment of this account against this bucket (envs/test names its bucket in its backend block)."
  value       = terraform.workspace == "test" ? "terraform -chdir=infra/envs/test init" : "terraform -chdir=infra/envs/prod init -backend-config=\"bucket=${aws_s3_bucket.state.bucket}\""
}
