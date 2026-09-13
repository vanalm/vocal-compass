# One Vocal Compass environment: the Cloud Run service that serves SPA and API
# (service.tf), its Postgres (sql.tf), its secrets (secrets.tf), and the
# identity it runs as (below).

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  name = "vc-${var.environment}"

  # Cloud Run's deterministic URL is computable before the service exists, so
  # an env without a domain can use it as APP_BASE_URL (OAuth redirect, Origin
  # check) without a dependency cycle.
  app_url = coalesce(var.app_base_url, "https://${local.name}-app-${data.google_project.this.number}.${var.region}.run.app")
}

resource "google_service_account" "app" {
  account_id   = "${local.name}-app"
  display_name = "Vocal Compass ${var.environment} runtime"
}

# The /cloudsql connector authorizes by IAM; the per-environment database
# password is what separates staging from prod.
resource "google_project_iam_member" "app_cloudsql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = google_service_account.app.member
}

# gcloud run deploy needs actAs on the account a revision runs as; granted on
# this account only, never project-wide.
resource "google_service_account_iam_member" "deployer_act_as" {
  service_account_id = google_service_account.app.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.deployer_service_account}"
}
