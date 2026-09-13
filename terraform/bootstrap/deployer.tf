# GitHub Actions deploys keylessly: an OIDC token from a workflow running on
# main in this repository is exchanged for the vc-deployer service account.
# Terraform is applied by an operator, so the deployer can push images and roll
# revisions and nothing more.
#
# actAs on the runtime service accounts is granted per account in modules/app,
# not project-wide: project-wide would let a deploy run a revision as any
# account in the project, including the Editor-bearing default compute one.

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "vc-github"
  display_name              = "GitHub Actions"

  depends_on = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"                = "assertion.sub"
    "attribute.repository"          = "assertion.repository" # owner/name, for readable audit logs
    "attribute.repository_id"       = "assertion.repository_id"
    "attribute.repository_owner_id" = "assertion.repository_owner_id"
    "attribute.ref"                 = "assertion.ref"
  }

  # Without this, a token minted for any GitHub repository would be accepted.
  # It matches ids, not owner/name: once a repository is renamed or deleted,
  # someone else can register its name, never its ids. Only main may deploy, so
  # a workflow on any other branch gets no deploy credentials.
  attribute_condition = "assertion.repository_id == '${var.github_repository_id}' && assertion.repository_owner_id == '${var.github_repository_owner_id}' && assertion.ref == 'refs/heads/main'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "vc-deployer"
  display_name = "Vocal Compass GitHub deployer"

  depends_on = [google_project_service.apis]
}

resource "google_service_account_iam_member" "deployer_github" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}

resource "google_project_iam_member" "deployer_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = google_service_account.deployer.member
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  location   = google_artifact_registry_repository.vc.location
  repository = google_artifact_registry_repository.vc.name
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.deployer.member
}
