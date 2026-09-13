output "service_name" {
  description = "Cloud Run service name, the target of gcloud run deploy."
  value       = google_cloud_run_v2_service.app.name
}

output "service_uri" {
  description = "Cloud Run's own URL for the service."
  value       = google_cloud_run_v2_service.app.uri
}

output "app_url" {
  description = "Origin the app is configured for (APP_BASE_URL)."
  value       = local.app_url
}

output "region" {
  description = "Region the service and database run in."
  value       = google_cloud_run_v2_service.app.location
}

output "sql_instance_name" {
  description = "Cloud SQL instance name."
  value       = google_sql_database_instance.this.name
}

output "sql_connection_name" {
  description = "Cloud SQL connection name (project:region:instance), as mounted under /cloudsql."
  value       = google_sql_database_instance.this.connection_name
}

output "runtime_service_account" {
  description = "Email of the service account the app runs as."
  value       = google_service_account.app.email
}
