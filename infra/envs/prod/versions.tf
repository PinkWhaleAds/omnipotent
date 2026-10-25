terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State in the bucket created by infra/bootstrap, locked with S3's native lock file (no DynamoDB).
  # The bucket name holds the account id, so it is given at init:
  #   terraform init -backend-config="bucket=<state bucket>"
  backend "s3" {
    key          = "prod/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }
}
