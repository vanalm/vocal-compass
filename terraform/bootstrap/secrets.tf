# The WorkOS API key is the one runtime secret Terraform cannot generate. Its
# containers live here, not in the env stacks, so an operator can add a version
# before an env is applied; Cloud Run will not start a revision whose secret
# has no version, and modules/app refuses to plan without one.

resource "google_secret_manager_secret" "workos_api_key" {
  for_each = var.environments

  secret_id = "vc-${each.key}-workos-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}
