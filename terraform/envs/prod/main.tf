# Production: deletion protection on. With a domain it sits behind the edge
# load balancer and Cloud CDN, and Cloud Run accepts load-balancer traffic only.
#
#   terraform init -backend-config="bucket=<project_id>-vc-tfstate"
#   terraform apply
#
# Needs bootstrap applied, a version on vc-prod-workos-api-key, and an image at
# app:bootstrap (terraform/README.md, First deploy, lists the commands). After the
# apply, create the dns_record output at the DNS host.

terraform {
  required_version = ">= 1.9"

  backend "gcs" {
    prefix = "envs/prod"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.12"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  environment = "prod"
}

module "app" {
  source = "../../modules/app"

  project_id          = var.project_id
  region              = var.region
  environment         = local.environment
  image               = coalesce(var.image, "${var.region}-docker.pkg.dev/${var.project_id}/vc/app:bootstrap")
  app_base_url        = var.domain == "" ? "" : "https://${var.domain}"
  workos_client_id    = var.workos_client_id
  auth_allowed_emails = var.auth_allowed_emails
  deletion_protection = true

  # With a domain, only the load balancer may reach the service, so its TLS
  # and CDN cannot be bypassed through run.app.
  ingress = var.domain == "" ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  deployer_service_account = "vc-deployer@${var.project_id}.iam.gserviceaccount.com"
}

module "edge" {
  source = "../../modules/edge"
  count  = var.domain == "" ? 0 : 1

  region       = module.app.region
  environment  = local.environment
  domain       = var.domain
  service_name = module.app.service_name
}

module "observability" {
  source = "../../modules/observability"

  project_id          = var.project_id
  region              = module.app.region
  environment         = local.environment
  alert_email         = var.alert_email
  service_name        = module.app.service_name
  sql_instance_name   = module.app.sql_instance_name
  uptime_host         = trimprefix(module.app.app_url, "https://") # domain, else run.app host
  deletion_protection = true
}
