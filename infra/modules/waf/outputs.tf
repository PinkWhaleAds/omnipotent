output "web_acl_arn" {
  description = "ARN of the web ACL (the web_acl_id of the CloudFront distributions)."
  value       = aws_wafv2_web_acl.this.arn
}

output "web_acl_name" {
  description = "Name of the web ACL (CloudWatch dimension WebACL, region us-east-1, Rule = ALL or a rule's metric name)."
  value       = aws_wafv2_web_acl.this.name
}
