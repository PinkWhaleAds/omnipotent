variable "name" {
  description = "Prefix of the resource names (e.g. omnipotent-prod). The ALB name is cut to 32 characters."
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets of the internal load balancer (one per Availability Zone)."
  type        = list(string)
}

variable "target_security_group_id" {
  description = "Security group of the API tasks: the load balancer is allowed to reach them on target_port."
  type        = string
}

variable "target_port" {
  description = "Port of the API container."
  type        = number
  default     = 3000
}

variable "health_check_path" {
  description = "Readiness route of the backend: 503 while starting, while PostgreSQL or the job queue is down, and as soon as a shutdown starts."
  type        = string
  default     = "/readyz"
}

variable "deregistration_delay" {
  description = "Seconds a deregistered task keeps its in-flight requests. ECS waits for it before sending SIGTERM; it matches the CloudFront origin read timeout so a deploy cuts no request."
  type        = number
  default     = 60
}

variable "idle_timeout" {
  description = "Idle timeout of the connections, in seconds: above the CloudFront origin read timeout (60 s) and below the backend's keep-alive timeout (Fastify: 72 s)."
  type        = number
  default     = 65
}

variable "origin_header_name" {
  description = "Header CloudFront adds to every origin request; without its secret value the load balancer answers 403."
  type        = string
  default     = "X-Origin-Verify"
}

variable "access_logs_bucket" {
  description = "S3 bucket of the access logs (null: off). The bucket must allow the ELB log delivery."
  type        = string
  default     = null
}

variable "access_logs_prefix" {
  description = "Prefix of the access logs in the bucket (the bucket policy allows <prefix>/AWSLogs/<account>/)."
  type        = string
  default     = "alb"
}
