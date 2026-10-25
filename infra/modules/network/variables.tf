variable "name" {
  description = "Prefix of the resource names (e.g. omnipotent-prod)."
  type        = string
}

variable "cidr_block" {
  description = "CIDR block of the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of availability zones (one public and one private subnet in each)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 4
    error_message = "az_count must be between 2 and 4 (the ALB and RDS need two zones)."
  }
}

variable "nat_gateway_enabled" {
  description = "NAT gateway(s) giving the private subnets their way out to the internet (and a fixed egress IP). false: none, the private subnets have no route to the internet; whatever must call out runs in the public subnets with a public IP."
  type        = bool
  default     = true
}

variable "nat_gateway_per_az" {
  description = "One NAT gateway per zone (survives the loss of a zone, costs one gateway and one IP per zone) instead of a single shared one."
  type        = bool
  default     = false
}

variable "enable_flow_logs" {
  description = "Send the VPC flow logs (all traffic) to flow_logs_destination_arn."
  type        = bool
  default     = false
}

variable "flow_logs_destination_arn" {
  description = "S3 destination of the flow logs: the ARN of the bucket followed by a folder (arn:aws:s3:::<bucket>/<folder>/), whose policy lets delivery.logs.amazonaws.com write there. Required with enable_flow_logs."
  type        = string
  default     = null

  validation {
    condition     = !var.enable_flow_logs || can(regex("^arn:aws[a-z-]*:s3:::[^/]+(/.*)?$", var.flow_logs_destination_arn))
    error_message = "With enable_flow_logs, flow_logs_destination_arn is the ARN of an S3 bucket, optionally followed by a folder."
  }
}
