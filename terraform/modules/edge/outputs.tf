output "ip_address" {
  description = "Static IPv4 address of the load balancer."
  value       = google_compute_global_address.edge.address
}

output "dns_record" {
  description = "The DNS record to create at Cloudflare for the certificate to provision."
  value       = "A ${var.domain} -> ${google_compute_global_address.edge.address}, DNS only (grey cloud). A proxied record hides this IP and the Google-managed certificate never provisions."
}
