# The public health endpoint, probed the way a user reaches it: through the
# domain (load balancer, certificate, CDN) when there is one. Its alert is
# local.alerts.uptime in alerts.tf.

resource "google_monitoring_uptime_check_config" "health" {
  display_name = "${local.name} /api/health"
  period       = "60s"
  timeout      = "10s"

  # Five checker locations across three regions; the alert needs more than one
  # to fail, so a single location's network trouble never pages.
  selected_regions = ["USA", "EUROPE", "ASIA_PACIFIC"]

  # Failed probes are logged with the reason (TLS, timeout, body mismatch).
  log_check_failures = true

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"

    labels = {
      project_id = var.project_id
      host       = var.uptime_host
    }
  }

  # A 200 from anything but this app (a parked domain, a misrouted load
  # balancer) must still fail. FastAPI renders JSON without spaces.
  content_matchers {
    content = "\"status\":\"ok\""
    matcher = "CONTAINS_STRING"
  }
}
