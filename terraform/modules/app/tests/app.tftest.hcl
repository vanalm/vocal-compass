mock_provider "google" {
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
  mock_resource "google_sql_database_instance" {
    defaults = { connection_name = "demo-project:us-west1:vc-staging-sql" }
  }
  mock_resource "google_service_account" {
    defaults = {
      email  = "vc-staging-app@demo-project.iam.gserviceaccount.com"
      member = "serviceAccount:vc-staging-app@demo-project.iam.gserviceaccount.com"
      name   = "projects/demo-project/serviceAccounts/vc-staging-app@demo-project.iam.gserviceaccount.com"
    }
  }
}

variables {
  project_id               = "demo-project"
  region                   = "us-west1"
  environment              = "staging"
  image                    = "us-west1-docker.pkg.dev/demo-project/vc/app:bootstrap"
  workos_client_id         = "client_01TEST"
  deletion_protection      = false
  deployer_service_account = "vc-deployer@demo-project.iam.gserviceaccount.com"
}

run "staging_without_domain" {
  command = apply

  assert {
    condition     = output.app_url == "https://vc-staging-app-123456789012.us-west1.run.app"
    error_message = "empty app_base_url must derive the deterministic run.app URL"
  }
  assert {
    condition     = { for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name => e.value if e.value != null && e.value != "" } == { ENVIRONMENT = "staging", APP_BASE_URL = "https://vc-staging-app-123456789012.us-west1.run.app", AUTH_MODE = "workos", WORKOS_CLIENT_ID = "client_01TEST", GOOGLE_CLOUD_PROJECT = "demo-project", LOG_FORMAT = "json", RUN_MIGRATIONS_ON_START = "1", TRUSTED_PROXY_HOPS = "1" }
    error_message = "plain env mismatch (AUTH_ALLOWED_EMAILS must be absent when empty; run.app traffic passes one proxy)"
  }
  assert {
    condition     = { for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name => "${e.value_source[0].secret_key_ref[0].secret}@${e.value_source[0].secret_key_ref[0].version}" if length(e.value_source) > 0 } == { DATABASE_URL = "vc-staging-database-url@latest", WORKOS_API_KEY = "vc-staging-workos-api-key@latest", WORKOS_COOKIE_PASSWORD = "vc-staging-workos-cookie-password@latest" }
    error_message = "secret env mismatch"
  }
  assert {
    condition     = can(regex("^postgresql\\+psycopg://vocal:[A-Za-z0-9]{32}@/vocal\\?host=/cloudsql/demo-project:us-west1:vc-staging-sql$", nonsensitive(google_secret_manager_secret_version.database_url.secret_data)))
    error_message = "DATABASE_URL must be the unix-socket psycopg form"
  }
  assert {
    condition     = can(regex("^[A-Za-z0-9+/]{43}=$", nonsensitive(google_secret_manager_secret_version.cookie_password.secret_data)))
    error_message = "cookie password must be a Fernet key: 32 random bytes, base64"
  }
  assert {
    condition     = { for k, m in google_secret_manager_secret_iam_member.app : k => m.secret_id } == { DATABASE_URL = "projects/demo-project/secrets/vc-staging-database-url", WORKOS_API_KEY = "projects/demo-project/secrets/vc-staging-workos-api-key", WORKOS_COOKIE_PASSWORD = "projects/demo-project/secrets/vc-staging-workos-cookie-password" }
    error_message = "one accessor grant per secret the container reads"
  }
  assert {
    condition     = data.google_secret_manager_secret_version.workos_api_key.fetch_secret_data == false
    error_message = "the WorkOS key value must never be read into state"
  }
  assert {
    condition     = google_service_account_iam_member.deployer_act_as.member == "serviceAccount:vc-deployer@demo-project.iam.gserviceaccount.com" && google_service_account_iam_member.deployer_act_as.role == "roles/iam.serviceAccountUser"
    error_message = "deployer actAs must be scoped to the runtime SA"
  }
  assert {
    condition     = google_cloud_run_v2_service.app.ingress == "INGRESS_TRAFFIC_ALL" && google_cloud_run_v2_service.app.deletion_protection == false && google_sql_database_instance.this.settings[0].deletion_protection_enabled == false
    error_message = "staging defaults"
  }
  assert {
    condition     = google_cloud_run_v2_service.app.template[0].containers[0].resources[0].limits["memory"] == "1Gi" && google_cloud_run_v2_service.app.template[0].max_instance_request_concurrency == 80
    error_message = "1Gi by default: each of 80 concurrent requests may buffer a 4 MB sync body before the 2-slot guard"
  }
  assert {
    condition     = google_sql_database_instance.this.settings[0].ip_configuration[0].ssl_mode == "ENCRYPTED_ONLY" && length(google_sql_database_instance.this.settings[0].ip_configuration[0].authorized_networks) == 0
    error_message = "connector-only SQL"
  }
}

run "prod_with_domain" {
  command = apply

  variables {
    environment         = "prod"
    app_base_url        = "https://vocalcompass.app"
    auth_allowed_emails = "a@example.com, @example.org"
    ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
    deletion_protection = true
  }

  assert {
    condition     = output.app_url == "https://vocalcompass.app"
    error_message = "explicit app_base_url wins"
  }
  assert {
    condition     = { for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name => e.value if e.value != null && e.value != "" }["ENVIRONMENT"] == "production"
    error_message = "prod maps to ENVIRONMENT=production"
  }
  assert {
    condition     = { for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name => e.value if e.value != null && e.value != "" }["AUTH_ALLOWED_EMAILS"] == "a@example.com, @example.org"
    error_message = "allowlist passes through when set"
  }
  assert {
    condition     = { for e in google_cloud_run_v2_service.app.template[0].containers[0].env : e.name => e.value if e.value != null && e.value != "" }["TRUSTED_PROXY_HOPS"] == "2"
    error_message = "load-balancer-only traffic passes two proxies"
  }
  assert {
    condition     = google_cloud_run_v2_service.app.deletion_protection && google_sql_database_instance.this.deletion_protection && google_sql_database_instance.this.settings[0].deletion_protection_enabled
    error_message = "prod protection on"
  }
}

run "rejects_placeholder_project" {
  command = plan
  variables {
    project_id = "REPLACE-ME"
  }
  expect_failures = [var.project_id]
}

run "rejects_placeholder_client_id" {
  command = plan
  variables {
    workos_client_id = "REPLACE-ME"
  }
  expect_failures = [var.workos_client_id]
}

run "rejects_max_below_min" {
  command = plan
  variables {
    min_instances = 3
    max_instances = 2
  }
  expect_failures = [var.max_instances]
}

run "rejects_trailing_slash" {
  command = plan
  variables {
    app_base_url = "https://vocalcompass.app/"
  }
  expect_failures = [var.app_base_url]
}

run "rejects_fractional_cpu" {
  command = plan
  variables {
    cpu = "0.5"
  }
  expect_failures = [var.cpu]
}

run "rejects_bad_allowlist" {
  command = plan
  variables {
    auth_allowed_emails = "not-an-email"
  }
  expect_failures = [var.auth_allowed_emails]
}
