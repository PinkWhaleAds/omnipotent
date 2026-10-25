# What the deploy workflow needs to know about the infrastructure, written by Terraform so that the
# workflow holds no resource name. None of these values is secret.
resource "aws_ssm_parameter" "this" {
  for_each = var.parameters

  name  = "${var.path}/${each.key}"
  type  = "String"
  tier  = "Standard"
  value = each.value
}
