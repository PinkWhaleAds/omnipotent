output "bucket_name" {
  description = "Name of the bucket (S3_BUCKET)."
  value       = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  description = "ARN of the bucket."
  value       = aws_s3_bucket.this.arn
}
