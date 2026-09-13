# The first apply runs on local state, because the bucket it creates does not
# exist yet. A gitignored override swaps the backend, then the state moves in:
#
#   echo 'terraform { backend "local" {} }' > backend_override.tf
#   terraform init && terraform apply
#   rm backend_override.tf
#   terraform init -migrate-state -backend-config="bucket=<project_id>-vc-tfstate"
terraform {
  required_version = ">= 1.9"

  backend "gcs" {
    prefix = "bootstrap"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
