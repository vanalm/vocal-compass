locals {
  # AUTH_ALLOWED_EMAILS empty means open signup, same as unset, so empty
  # values are left off rather than sent as blank variables.
  plain_env = { for name, value in {
    ENVIRONMENT             = var.environment == "prod" ? "production" : var.environment
    APP_BASE_URL            = local.app_url
    AUTH_MODE               = "workos"
    WORKOS_CLIENT_ID        = var.workos_client_id
    AUTH_ALLOWED_EMAILS     = var.auth_allowed_emails
    GOOGLE_CLOUD_PROJECT    = var.project_id
    LOG_FORMAT              = "json"
    RUN_MIGRATIONS_ON_START = "1"
    # Proxies that append to X-Forwarded-For before the app: Cloud Run's front
    # end, plus the load balancer when it is the only way in. The app takes the
    # client address from that far from the right, for rate limits.
    TRUSTED_PROXY_HOPS = var.ingress == "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" ? "2" : "1"
  } : name => value if value != "" }
}

resource "google_cloud_run_v2_service" "app" {
  name                = "${local.name}-app"
  location            = var.region
  ingress             = var.ingress
  deletion_protection = var.deletion_protection

  template {
    service_account                  = google_service_account.app.email
    timeout                          = "60s"
    max_instance_request_concurrency = 80

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    volumes {
      name = "cloudsql"

      cloud_sql_instance {
        instances = [google_sql_database_instance.this.connection_name]
      }
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # Scale-from-zero starts run migrations and imports before serving.
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.plain_env

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = local.secret_env

        content {
          name = env.key

          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      # The entrypoint migrates before uvicorn listens, so the startup budget
      # (5s x 24 = 2 min) covers a migration, not just boot.
      startup_probe {
        http_get {
          path = "/api/ready"
        }
        period_seconds    = 5
        timeout_seconds   = 3
        failure_threshold = 24
      }

      liveness_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds    = 30
        timeout_seconds   = 5
        failure_threshold = 3
      }
    }
  }

  lifecycle {
    # The deploy workflow owns the running image (gcloud run deploy); client
    # fields record whichever tool touched the service last.
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  # A revision reads its secrets and opens its socket at startup, so every
  # grant and value must exist before the first one is created.
  depends_on = [
    google_project_iam_member.app_cloudsql,
    google_secret_manager_secret_iam_member.app,
    google_secret_manager_secret_version.database_url,
    google_secret_manager_secret_version.cookie_password,
    data.google_secret_manager_secret_version.workos_api_key,
  ]
}

# A public web app; ingress decides whether "public" means the run.app URL or
# only through the load balancer.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.app.name
  location = google_cloud_run_v2_service.app.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
