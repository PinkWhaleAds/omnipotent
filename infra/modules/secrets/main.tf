# Secret CONTAINERS only. Their values are written by hand (aws secretsmanager put-secret-value, see
# infra/README.md) or by the backend itself, never by Terraform: no value ever reaches the variables or the
# state. They use the AWS managed key (aws/secretsmanager).
#
# Which containers exist is the caller's business (`secrets`): the socle creates none, and the phase that needs
# a credential — a platform's API key, the Anthropic key, a signing key — declares it in envs/prod/main.tf.
resource "aws_secretsmanager_secret" "this" {
  for_each = var.secrets

  name                    = "${var.prefix}/${each.value.name}"
  description             = each.value.description
  recovery_window_in_days = var.recovery_window_in_days
}
