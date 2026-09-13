output "service_uri" {
  description = "Cloud Run's own URL. Serves traffic only while domain is empty; with a domain, ingress is load-balancer only."
  value       = module.app.service_uri
}

output "app_url" {
  description = "Public origin of the app: the GitHub variable STAGING_URL."
  value       = module.app.app_url
}

output "load_balancer_ip" {
  description = "Load balancer IP address, or null when domain is empty."
  value       = one(module.edge[*].ip_address)
}

output "dns_record" {
  description = "DNS record to create for the domain, or null when domain is empty."
  value       = one(module.edge[*].dns_record)
}

output "dashboard_url" {
  description = "Cloud Monitoring dashboard for this environment."
  value       = module.observability.dashboard_url
}

output "events_dataset" {
  description = "BigQuery dataset (project.dataset) holding domain events; the table is run_googleapis_com_stdout."
  value       = module.observability.events_dataset
}
