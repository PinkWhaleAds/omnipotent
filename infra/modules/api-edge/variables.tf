variable "name" {
  description = "Prefix of the resource names (e.g. omnipotent-prod)."
  type        = string
}

variable "alb_dns_name" {
  description = "DNS name of the internal API load balancer (the origin domain of its VPC origin)."
  type        = string
}

variable "alb_arn" {
  description = "ARN of the internal API load balancer, reached as a CloudFront VPC origin."
  type        = string
}

variable "origin_header_name" {
  description = "Name of the secret header the load balancer requires."
  type        = string
}

variable "origin_header_value" {
  description = "Value of the secret header the load balancer requires."
  type        = string
  sensitive   = true
}

variable "origin_read_timeout" {
  description = "Seconds CloudFront waits for the backend's response (60 at most without an AWS quota increase, up to 180 with one)."
  type        = number
  default     = 60
}

variable "cached_path_patterns" {
  description = "Paths whose caching follows the backend's Cache-Control. None in the socle: the API answers are never cached; a phase serving a public file adds its path here."
  type        = list(string)
  default     = []
}

variable "price_class" {
  description = "CloudFront price class (PriceClass_100: Europe and North America edges)."
  type        = string
  default     = "PriceClass_100"
}

variable "web_acl_arn" {
  description = "ARN of the WAF web ACL (scope CLOUDFRONT) in front of the distribution; null: none."
  type        = string
  default     = null
}

variable "logs_bucket_domain_name" {
  description = "Domain (bucket.s3.amazonaws.com) of the bucket receiving the standard logs; null: no logs."
  type        = string
  default     = null
}

variable "logs_prefix" {
  description = "Prefix of the standard logs in the bucket."
  type        = string
  default     = "cloudfront/api/"
}

variable "alias" {
  description = "Custom hostname of the API (api.example.com), served with certificate_arn; null: only the default xxxx.cloudfront.net domain."
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "ARN of the ACM certificate covering alias (us-east-1, issued); required with alias."
  type        = string
  default     = null

  validation {
    condition     = var.alias == null || var.certificate_arn != null
    error_message = "An alias needs the ARN of its ACM certificate (us-east-1)."
  }
}

variable "tracking_alias" {
  description = "Hostname of the tracking scripts (s.example.com): creates the distribution that serves /t/* only, with tracking_certificate_arn. null: none (the API's distribution serves /t/* anyway)."
  type        = string
  default     = null
}

variable "tracking_certificate_arn" {
  description = "ARN of the ACM certificate covering tracking_alias (us-east-1, issued); required with tracking_alias."
  type        = string
  default     = null

  validation {
    condition     = var.tracking_alias == null || var.tracking_certificate_arn != null
    error_message = "tracking_alias needs the ARN of its ACM certificate (us-east-1)."
  }
}

variable "tracking_logs_prefix" {
  description = "Prefix of the tracking distribution's standard logs in the bucket."
  type        = string
  default     = "cloudfront/tracking/"
}
