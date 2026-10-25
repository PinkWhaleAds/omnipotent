# Applied once per AWS account with a LOCAL state: it creates the bucket that holds the state of
# every other stack (envs/*). One Terraform workspace per account, so that each account's local state stays apart:
# "default" for production's account (terraform.tfstate), "test" for the test account
# (terraform.tfstate.d/test/terraform.tfstate). Keep the local state files (git-ignored); losing one only means
# importing the bucket again before changing it.
terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  # A workspace tied to an account refuses any other (a guard against the wrong AWS_PROFILE).
  allowed_account_ids = lookup(local.workspace_accounts, terraform.workspace, null)

  default_tags {
    tags = {
      Project   = var.project
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}
