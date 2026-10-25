# They read the bucket through the resources the deliveries need, so a distribution, the load balancer or the flow
# log only turns its logs on once the bucket accepts them (the load balancer checks it with a test file; a flow log
# created before the policy would replace it with AWS's own).
output "bucket_domain_name" {
  description = "Domain of the bucket (bucket.s3.amazonaws.com), the logging_config of the CloudFront distributions."
  value       = aws_s3_bucket.this.bucket_domain_name

  depends_on = [aws_s3_bucket_ownership_controls.this, aws_s3_bucket_policy.this]
}

output "bucket_name" {
  description = "Name of the bucket, the access_logs of the load balancer."
  value       = aws_s3_bucket_policy.this.bucket
}

output "alb_prefix" {
  description = "Prefix of the load balancer's logs in the bucket."
  value       = local.alb_prefix
}

output "cloudfront_prefixes" {
  description = "Prefix of each distribution's logs in the bucket."
  value       = { api = "cloudfront/api/", tracking = "cloudfront/tracking/" }
}

output "flow_logs_destination_arn" {
  description = "S3 destination of the VPC flow logs (bucket ARN and folder), once the bucket policy allows their delivery."
  value       = "${aws_s3_bucket.this.arn}/${local.flow_logs_prefix}/"

  depends_on = [aws_s3_bucket_policy.this]
}
