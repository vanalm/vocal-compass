# What one environment reports and to whom: log-based metrics over the app's
# domain events (metrics.tf), the uptime check (uptime.tf), alerts that email
# var.alert_email (alerts.tf), a dashboard (dashboard.tf), and the BigQuery
# sink that keeps every event for SQL (events.tf).

locals {
  name = "vc-${var.environment}"

  # Valid both as a Cloud Logging query and as a Cloud Monitoring filter, so
  # log metrics, the event sink, alerts and charts all select the same service.
  service = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.service_name}\""
  sql     = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:${var.sql_instance_name}\""
}

resource "google_monitoring_notification_channel" "email" {
  display_name = "${local.name} alerts"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }
}
