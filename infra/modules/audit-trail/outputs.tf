output "trail_arn" {
  description = "ARN of the trail."
  value       = aws_cloudtrail.this.arn
}

output "bucket_name" {
  description = "Bucket of the trail logs."
  value       = aws_s3_bucket.this.bucket
}
