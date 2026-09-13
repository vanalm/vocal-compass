output "state_bucket" {
  description = "Bucket holding every root's state: terraform init -backend-config=\"bucket=<this>\"."
  value       = google_storage_bucket.tfstate.name
}

output "artifact_registry" {
  description = "Docker repository prefix; the app image is <this>/app:<tag>."
  value       = google_artifact_registry_repository.vc.registry_uri
}

output "workload_identity_provider" {
  description = "Full provider name for google-github-actions/auth (GitHub variable GCP_WIF_PROVIDER)."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "Service account GitHub Actions impersonates (GitHub variable GCP_DEPLOYER_SA)."
  value       = google_service_account.deployer.email
}

output "workos_api_key_secret_ids" {
  description = "Per environment, the secret that needs a version before that env's first apply."
  value       = { for env, secret in google_secret_manager_secret.workos_api_key : env => secret.secret_id }
}

# The steps live only in the README, so this cannot drift into a second,
# different copy of them.
output "next_steps" {
  description = "Where the first deploy continues, with the values its commands need."
  value       = <<-EOT
    Continue with terraform/README.md, "First deploy": finish step 1 by moving
    this state into ${google_storage_bucket.tfstate.name}, then go on from step 2.
    Its placeholders: <project_id> = ${var.project_id}, <region> = ${var.region}.
  EOT
}
