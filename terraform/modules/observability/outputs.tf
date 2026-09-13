output "dashboard_url" {
  description = "Cloud Console link to the environment's dashboard."
  value       = "https://console.cloud.google.com/monitoring/dashboards/builder/${regex("[^/]+$", google_monitoring_dashboard.this.id)}?project=${var.project_id}"
}

output "events_dataset" {
  description = "BigQuery dataset (project.dataset) holding domain events; the table is run_googleapis_com_stdout."
  value       = "${var.project_id}.${google_bigquery_dataset.events.dataset_id}"
}
