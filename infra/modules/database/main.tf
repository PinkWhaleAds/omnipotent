resource "aws_db_subnet_group" "this" {
  name       = var.identifier
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "this" {
  name        = "${var.identifier}-db"
  description = "PostgreSQL, reachable from the ECS tasks only"
  vpc_id      = var.vpc_id

  tags = { Name = "${var.identifier}-db" }
}

# count, not for_each: the client security groups are usually created in the same apply, and for_each
# needs its keys at plan time.
resource "aws_vpc_security_group_ingress_rule" "clients" {
  count = length(var.client_security_group_ids)

  security_group_id            = aws_security_group.this.id
  referenced_security_group_id = var.client_security_group_ids[count.index]
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "PostgreSQL from the ECS tasks"
}

# TLS is mandatory (rds.force_ssl, already the default from PostgreSQL 15 on) and the backend verifies
# the server certificate against the Amazon RDS CA bundle added to its image.
resource "aws_db_parameter_group" "this" {
  name        = "${var.identifier}-pg${split(".", var.engine_version)[0]}"
  family      = "postgres${split(".", var.engine_version)[0]}"
  description = "omnipotent: TLS required"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Created beforehand so that the exported logs get a retention (RDS would create it without one).
resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${var.identifier}/postgresql"
  retention_in_days = var.log_retention_days
}

resource "aws_db_instance" "this" {
  identifier = var.identifier

  engine                      = "postgres"
  engine_version              = var.engine_version
  auto_minor_version_upgrade  = true
  allow_major_version_upgrade = false
  instance_class              = var.instance_class
  parameter_group_name        = aws_db_parameter_group.this.name
  ca_cert_identifier          = var.ca_cert_identifier

  db_name                     = var.db_name
  username                    = var.username
  manage_master_user_password = true

  # The API and the worker sign in as a role granted rds_iam with short-lived tokens of their task role
  # (rds-db:connect), not with the master password.
  iam_database_authentication_enabled = var.iam_authentication

  storage_type          = "gp3"
  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_encrypted     = true

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.this.id]
  publicly_accessible    = false
  port                   = 5432

  backup_retention_period   = var.backup_retention_days
  backup_window             = var.backup_window
  maintenance_window        = var.maintenance_window
  copy_tags_to_snapshot     = true
  delete_automated_backups  = var.delete_automated_backups
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.identifier}-final"

  # Free tier of Performance Insights (7 days of history).
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  enabled_cloudwatch_logs_exports = ["postgresql"]
  apply_immediately               = var.apply_immediately

  depends_on = [aws_cloudwatch_log_group.postgresql]
}

# RDS rotates the master password itself (every 7 days unless told otherwise). With IAM authentication only
# the migration task uses it, reading it when it starts; without, the API and worker tasks receive it at start
# and each rotation is followed by a redeploy of the services (module db-rotation-restart): schedule it at a
# quiet time.
resource "aws_secretsmanager_secret_rotation" "master_password" {
  secret_id          = aws_db_instance.this.master_user_secret[0].secret_arn
  rotate_immediately = false

  rotation_rules {
    schedule_expression = var.password_rotation_schedule
    duration            = "2h"
  }
}
