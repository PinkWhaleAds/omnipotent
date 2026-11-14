# Mocked AWS responses of the us-east-1 provider (WAF web ACL, certificates of the custom domain), shared by
# envs/prod and envs/test.

mock_resource "aws_wafv2_web_acl" {
  defaults = {
    arn = "arn:aws:wafv2:us-east-1:123456789012:global/webacl/omnipotent-prod/abc"
  }
}

# An issued certificate and its validation record, as ACM describes them (names with their final dot).
mock_resource "aws_acm_certificate" {
  defaults = {
    arn    = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
    status = "ISSUED"
    domain_validation_options = [{
      domain_name           = "omnipotent.pinkwhale.co"
      resource_record_name  = "_0a1b2c3d4e5f.omnipotent.pinkwhale.co."
      resource_record_type  = "CNAME"
      resource_record_value = "_9f8e7d6c5b4a.xlfgrmvvlj.acm-validations.aws."
    }]
  }
}

mock_resource "aws_cloudwatch_log_group" {
  defaults = {
    arn = "arn:aws:logs:us-east-1:123456789012:log-group:aws-waf-logs-omnipotent-prod"
  }
}
