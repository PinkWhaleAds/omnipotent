output "domain_name" {
  description = "Domain of the API distribution (xxxx.cloudfront.net): the target of the API's CNAME with a custom domain."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "hostname" {
  description = "Hostname the API is served on: the custom one (alias), else the distribution's domain."
  value       = coalesce(var.alias, aws_cloudfront_distribution.this.domain_name)
}

output "distribution_id" {
  description = "ID of the API distribution."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  description = "ARN of the API distribution."
  value       = aws_cloudfront_distribution.this.arn
}

output "tracking_hostname" {
  description = "Hostname of the tracking scripts (tracking_alias), once its distribution serves it; null without one."
  value       = var.tracking_alias

  # Whatever builds a URL from it (the backend's environment) waits for the distribution, as with hostname.
  depends_on = [aws_cloudfront_distribution.tracking]
}

output "tracking_domain_name" {
  description = "Domain of the tracking distribution (xxxx.cloudfront.net), the target of the tracking host's CNAME; null without one."
  value       = one(aws_cloudfront_distribution.tracking[*].domain_name)
}
