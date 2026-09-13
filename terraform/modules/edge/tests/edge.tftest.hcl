mock_provider "google" {
  mock_resource "google_compute_global_address" {
    defaults = { address = "203.0.113.10" }
  }
}

variables {
  region       = "us-west1"
  environment  = "prod"
  domain       = "vocalcompass.app"
  service_name = "vc-prod-app"
}

run "lb_with_cdn_and_redirect" {
  command = apply

  assert {
    condition     = google_compute_backend_service.app.enable_cdn && google_compute_backend_service.app.cdn_policy[0].cache_mode == "USE_ORIGIN_HEADERS"
    error_message = "CDN must honor origin headers"
  }
  assert {
    condition     = google_compute_backend_service.app.load_balancing_scheme == "EXTERNAL_MANAGED" && google_compute_backend_service.app.log_config[0].enable && google_compute_backend_service.app.log_config[0].sample_rate == 1
    error_message = "backend scheme/logging"
  }
  assert {
    condition     = google_compute_region_network_endpoint_group.app.cloud_run[0].service == "vc-prod-app" && google_compute_region_network_endpoint_group.app.network_endpoint_type == "SERVERLESS"
    error_message = "NEG must target the service"
  }
  assert {
    condition     = google_compute_managed_ssl_certificate.edge.managed[0].domains == tolist(["vocalcompass.app"])
    error_message = "cert domain"
  }
  assert {
    condition     = google_compute_global_forwarding_rule.https.port_range == "443" && google_compute_global_forwarding_rule.http_redirect.port_range == "80"
    error_message = "ports"
  }
  assert {
    condition     = google_compute_url_map.http_redirect.default_url_redirect[0].https_redirect && google_compute_url_map.http_redirect.default_url_redirect[0].redirect_response_code == "MOVED_PERMANENTLY_DEFAULT"
    error_message = "HTTP must 301 to HTTPS"
  }
  assert {
    condition     = output.ip_address == "203.0.113.10" && strcontains(output.dns_record, "A vocalcompass.app -> 203.0.113.10")
    error_message = "outputs"
  }
}

run "rejects_domain_with_scheme" {
  command = plan
  variables {
    domain = "https://vocalcompass.app"
  }
  expect_failures = [var.domain]
}
