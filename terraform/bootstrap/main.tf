# Once-per-project plumbing every environment depends on: APIs, the state
# bucket, and the image registry. The deploy identity is in deployer.tf and
# the operator-supplied secrets in secrets.tf.

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "bigquery.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # WIF token exchange
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com", # WIF token exchange
  ])

  service = each.value
  # Envs outlive a bootstrap destroy; switching an API off would break them.
  disable_on_destroy = false
}

resource "google_storage_bucket" "tfstate" {
  name     = "${var.project_id}-vc-tfstate"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  # Every apply writes a new object version: the undo for a bad state write.
  versioning {
    enabled = true
  }
}

resource "google_artifact_registry_repository" "vc" {
  repository_id = "vc"
  location      = var.region
  format        = "DOCKER"
  description   = "Vocal Compass application images, tagged by git SHA."

  # KEEP outranks DELETE, so the 20 newest versions and app:bootstrap, which
  # recreating a service needs, always survive. Beyond them untagged images
  # (superseded pushes of a tag) go after 14 days, and every image after 90.
  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"

    most_recent_versions {
      keep_count = 20
    }
  }

  cleanup_policies {
    id     = "keep-bootstrap"
    action = "KEEP"

    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["bootstrap"]
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "1209600s" # 14 days
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"

    condition {
      tag_state  = "ANY"
      older_than = "7776000s" # 90 days
    }
  }

  depends_on = [google_project_service.apis]
}
