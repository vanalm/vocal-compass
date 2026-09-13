mock_provider "google" {
  mock_resource "google_artifact_registry_repository" {
    defaults = { registry_uri = "us-west1-docker.pkg.dev/demo-project/vc", name = "vc" }
  }
  mock_resource "google_iam_workload_identity_pool" {
    defaults = { name = "projects/123456789012/locations/global/workloadIdentityPools/vc-github" }
  }
  mock_resource "google_iam_workload_identity_pool_provider" {
    defaults = { name = "projects/123456789012/locations/global/workloadIdentityPools/vc-github/providers/github" }
  }
  mock_resource "google_service_account" {
    defaults = { email = "vc-deployer@demo-project.iam.gserviceaccount.com", member = "serviceAccount:vc-deployer@demo-project.iam.gserviceaccount.com", name = "projects/demo-project/serviceAccounts/vc-deployer@demo-project.iam.gserviceaccount.com" }
  }
}

run "committed_values_plan" {
  command = plan

  assert {
    condition     = google_storage_bucket.tfstate.name == "vocal-compass-vc-tfstate" && google_artifact_registry_repository.vc.location == "us-west1"
    error_message = "bootstrap.auto.tfvars holds the operator's project and region"
  }
}

run "bootstrap_outputs" {
  command = apply

  variables {
    project_id = "demo-project"
    region     = "us-west1"
  }

  assert {
    condition     = output.state_bucket == "demo-project-vc-tfstate" && google_storage_bucket.tfstate.versioning[0].enabled && google_storage_bucket.tfstate.public_access_prevention == "enforced" && !google_storage_bucket.tfstate.force_destroy
    error_message = "state bucket"
  }
  assert {
    condition     = output.workos_api_key_secret_ids == { prod = "vc-prod-workos-api-key", staging = "vc-staging-workos-api-key" }
    error_message = "secret ids"
  }
  assert {
    condition     = google_iam_workload_identity_pool_provider.github.attribute_condition == "assertion.repository_id == '1341356300' && assertion.repository_owner_id == '51979670' && assertion.ref == 'refs/heads/main'"
    error_message = "WIF condition must match the repository and owner ids, never owner/name, and only main"
  }
  assert {
    condition     = google_iam_workload_identity_pool_provider.github.attribute_mapping["attribute.repository_id"] == "assertion.repository_id" && google_iam_workload_identity_pool_provider.github.attribute_mapping["attribute.repository_owner_id"] == "assertion.repository_owner_id" && google_iam_workload_identity_pool_provider.github.attribute_mapping["attribute.repository"] == "assertion.repository"
    error_message = "WIF attribute mapping"
  }
  assert {
    condition     = google_service_account_iam_member.deployer_github.member == "principalSet://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vc-github/attribute.repository_id/1341356300"
    error_message = "WIF principalSet must bind the repository id"
  }
  assert {
    condition     = strcontains(output.next_steps, "terraform/README.md") && strcontains(output.next_steps, "demo-project-vc-tfstate") && strcontains(output.next_steps, "<region> = us-west1") && !strcontains(output.next_steps, "gcloud")
    error_message = "next_steps points at the README with this project's values instead of copying its commands"
  }
  assert {
    condition     = { for policy in google_artifact_registry_repository.vc.cleanup_policies : policy.id => policy.action } == { keep-recent = "KEEP", keep-bootstrap = "KEEP", delete-old-untagged = "DELETE", delete-old = "DELETE" }
    error_message = "cleanup policies"
  }
  assert {
    condition = anytrue([for policy in google_artifact_registry_repository.vc.cleanup_policies :
      policy.id == "delete-old" && policy.condition[0].tag_state == "ANY" && policy.condition[0].older_than == "7776000s"
    ])
    error_message = "tagged images beyond the newest 20 must age out after 90 days"
  }
  assert {
    condition     = length(google_project_service.apis) == 13
    error_message = "13 APIs"
  }
}

run "rejects_repository_name_as_id" {
  command = plan

  variables {
    project_id           = "demo-project"
    region               = "us-west1"
    github_repository_id = "vanalm/vocal-compass"
  }

  expect_failures = [var.github_repository_id]
}
