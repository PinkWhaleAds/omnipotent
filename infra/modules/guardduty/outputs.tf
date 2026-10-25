output "detector_id" {
  description = "ID of the GuardDuty detector of the region (for the CLI: aws guardduty update-detector --detector-id ...)."
  value       = aws_guardduty_detector.this.id
}

output "findings_rule_name" {
  description = "EventBridge rule sending the findings to the alarm topic."
  value       = aws_cloudwatch_event_rule.findings.name
}

output "fargate_agent_repository_arns" {
  description = "ECR repository of GuardDuty's Fargate agent, which the task execution role must be allowed to pull (empty without Runtime Monitoring)."
  value       = var.runtime_monitoring ? [local.fargate_agent_repository_arn] : []
}
