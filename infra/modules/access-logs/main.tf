# One private bucket for the access logs of the edge: CloudFront standard logs (legacy delivery to S3, free
# besides storage; one line per request with the client IP, status, path, edge and timings) of the
# distributions, the access logs of the internal load balancer and the VPC flow logs. Read them with Athena or by
# download.
#
#   cloudfront/api/        the API distribution
#   cloudfront/tracking/   the tracking scripts' distribution (with a custom domain)
#   alb/AWSLogs/<account>/elasticloadbalancing/<region>/...   the load balancer
#   vpc-flow/AWSLogs/<account>/vpcflowlogs/<region>/...        the VPC flow logs
#
# CloudFront's legacy delivery writes through an object ACL (the awslogsdelivery account, granted on the bucket
# ACL by CloudFront itself when logging is turned on), hence BucketOwnerPreferred instead of the ACL-less
# BucketOwnerEnforced of the other buckets. Nothing is public.
data "aws_caller_identity" "current" {}

# The account of Elastic Load Balancing in this region (Stockholm and the other regions opened before
# August 2022 deliver as this account; newer ones as the service principal, also allowed below).
data "aws_elb_service_account" "current" {}

data "aws_region" "current" {}

locals {
  account_id       = data.aws_caller_identity.current.account_id
  alb_prefix       = "alb"
  flow_logs_prefix = "vpc-flow"
}

resource "aws_s3_bucket" "this" {
  bucket        = var.bucket_name
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket = aws_s3_bucket.this.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3: the only encryption both CloudFront's legacy logs and the load balancer's logs support.
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "LoadBalancerLogs"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.this.arn}/${local.alb_prefix}/AWSLogs/${local.account_id}/*"]

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.current.arn]
    }
  }

  statement {
    sid       = "LoadBalancerLogDelivery"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.this.arn}/${local.alb_prefix}/AWSLogs/${local.account_id}/*"]

    principals {
      type        = "Service"
      identifiers = ["logdelivery.elasticloadbalancing.amazonaws.com"]
    }
  }

  # VPC flow logs, delivered by the log delivery service on behalf of this account's flow logs only (the policy AWS
  # documents; written here so that creating the flow log does not replace this policy with its own).
  statement {
    sid       = "FlowLogsWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.this.arn}/${local.flow_logs_prefix}/AWSLogs/${local.account_id}/*"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:${data.aws_region.current.region}:${local.account_id}:*"]
    }
  }

  statement {
    sid       = "FlowLogsAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.this.arn]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:${data.aws_region.current.region}:${local.account_id}:*"]
    }
  }

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.this.arn,
      "${aws_s3_bucket.this.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  bucket = aws_s3_bucket.this.id
  policy = data.aws_iam_policy_document.bucket.json

  depends_on = [aws_s3_bucket_public_access_block.this]
}
