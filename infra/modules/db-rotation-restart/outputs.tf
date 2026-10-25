output "state_machine_arn" {
  description = "ARN of the state machine redeploying the services (it can also be started by hand)."
  value       = aws_sfn_state_machine.this.arn
}
