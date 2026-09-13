# DATABASE_URL and the cookie password are generated and stored here, so no
# operator ever handles them. The WorkOS API key's container is bootstrap's and
# its value the operator's; this module only reads it.

locals {
  # Env var -> secret id. The container's secret env and the accessor grants
  # both come from this map, so a secret can never be wired without its grant.
  secret_env = {
    DATABASE_URL           = google_secret_manager_secret.database_url.secret_id
    WORKOS_API_KEY         = data.google_secret_manager_secret.workos_api_key.secret_id
    WORKOS_COOKIE_PASSWORD = google_secret_manager_secret.cookie_password.secret_id
  }
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "${local.name}-database-url"

  replication {
    auto {}
  }
}

# Unix-socket form: Cloud Run mounts the instance at /cloudsql/<connection name>.
resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql+psycopg://${google_sql_user.vocal.name}:${random_password.database.result}@/${google_sql_database.vocal.name}?host=/cloudsql/${google_sql_database_instance.this.connection_name}"
}

# The WorkOS SDK seals session cookies with Fernet, whose key is 32 random
# bytes in base64. Its decoder takes this standard alphabet as well as url-safe.
resource "random_bytes" "cookie" {
  length = 32
}

resource "google_secret_manager_secret" "cookie_password" {
  secret_id = "${local.name}-workos-cookie-password"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "cookie_password" {
  secret      = google_secret_manager_secret.cookie_password.id
  secret_data = random_bytes.cookie.base64
}

data "google_secret_manager_secret" "workos_api_key" {
  secret_id = "${local.name}-workos-api-key"
}

# Fails the plan until the operator has added the key, rather than a Cloud Run
# rollout failing minutes into the apply. Reads version metadata, never the value.
data "google_secret_manager_secret_version" "workos_api_key" {
  secret            = data.google_secret_manager_secret.workos_api_key.id
  fetch_secret_data = false
}

resource "google_secret_manager_secret_iam_member" "app" {
  for_each = local.secret_env

  secret_id = "projects/${var.project_id}/secrets/${each.value}"
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.app.member
}
