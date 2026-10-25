provider "aws" {
  region = var.region

  # Refuses to plan or apply in another account than these (allowed_account_ids; empty: any).
  allowed_account_ids = length(var.allowed_account_ids) > 0 ? var.allowed_account_ids : null

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# What CloudFront uses must live in us-east-1: the WAF web ACL in front of both distributions (and, with a
# domain, the ACM certificates).
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  allowed_account_ids = length(var.allowed_account_ids) > 0 ? var.allowed_account_ids : null

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
