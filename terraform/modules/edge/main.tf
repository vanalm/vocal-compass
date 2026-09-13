# A custom domain in front of one Cloud Run service: global external HTTPS load
# balancer, Google-managed certificate, Cloud CDN, and HTTP->HTTPS redirect on
# the same IP. Envs instantiate it only when they set a domain.

locals {
  name = "vc-${var.environment}"
}

resource "google_compute_global_address" "edge" {
  name = "${local.name}-ip"
}

# Provisions only after the domain resolves to the address above; apply does
# not wait for that. The name tracks the domain so a domain change can create
# the new certificate before the proxy lets go of the old one.
resource "google_compute_managed_ssl_certificate" "edge" {
  name = "${local.name}-cert-${substr(sha1(var.domain), 0, 8)}"

  managed {
    domains = [var.domain]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_region_network_endpoint_group" "app" {
  name                  = "${local.name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.service_name
  }
}

resource "google_compute_backend_service" "app" {
  name                  = "${local.name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  enable_cdn            = true

  backend {
    group = google_compute_region_network_endpoint_group.app.id
  }

  # The CDN stores only what the origin marks cacheable. The app sends
  # Cache-Control: no-store on every /api response, so authenticated JSON and
  # Set-Cookie responses are never cached; index.html is no-cache, so a release
  # shows immediately; only content-hashed /assets/* is held at the edge. A mode
  # that caches without origin consent (CACHE_ALL_STATIC, FORCE_CACHE_ALL)
  # would break that guarantee.
  cdn_policy {
    cache_mode = "USE_ORIGIN_HEADERS"

    # Cloud CDN's default key, spelled out because the provider requires a key
    # policy (or signed URLs) whenever cdn_policy is set.
    cache_key_policy {
      include_host         = true
      include_protocol     = true
      include_query_string = true
    }
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_url_map" "https" {
  name            = "${local.name}-https"
  default_service = google_compute_backend_service.app.id
}

resource "google_compute_target_https_proxy" "https" {
  name             = "${local.name}-https"
  url_map          = google_compute_url_map.https.id
  ssl_certificates = [google_compute_managed_ssl_certificate.edge.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${local.name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.edge.address
  port_range            = "443"
  target                = google_compute_target_https_proxy.https.id
}

resource "google_compute_url_map" "http_redirect" {
  name = "${local.name}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "http_redirect" {
  name    = "${local.name}-http-redirect"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name                  = "${local.name}-http-redirect"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.edge.address
  port_range            = "80"
  target                = google_compute_target_http_proxy.http_redirect.id
}
