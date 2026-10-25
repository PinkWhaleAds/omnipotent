output "alarm_topic_arn" {
  description = "ARN of the SNS topic receiving the alarms."
  value       = aws_sns_topic.alarms.arn
}
