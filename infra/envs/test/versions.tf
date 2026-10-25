# The test environment (infra/README.md, "Test environment"): the production configuration itself, in the test AWS
# account. main.tf, variables.tf, outputs.tf and providers.tf are links to ../prod (one configuration, never two to keep
# in step); this file (its own state) and test_override.tf (every difference from production, as variable defaults) are
# its own.
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

  # State in the bucket infra/bootstrap created in the test account (workspace "test" of the bootstrap), locked with S3's
  # native lock file. The account id in its name makes it the test account's own: no prod state can end up here.
  backend "s3" {
    bucket       = "omnipotent-tfstate-903305161052"
    key          = "test/terraform.tfstate"
    region       = "eu-north-1"
    encrypt      = true
    use_lockfile = true
  }
}
