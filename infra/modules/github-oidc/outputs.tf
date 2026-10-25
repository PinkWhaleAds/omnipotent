output "deploy_role_arn" {
  description = "ARN of the deploy role (GitHub variable AWS_DEPLOY_ROLE_ARN)."
  value       = aws_iam_role.deploy.arn
}

output "provider_arn" {
  description = "ARN of the GitHub OIDC provider of the account."
  value       = local.provider_arn
}
