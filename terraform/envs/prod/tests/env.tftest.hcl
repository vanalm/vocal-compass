mock_provider "google" {
  mock_data "google_project" {
    defaults = { number = "123456789012" }
  }
  mock_resource "google_monitoring_dashboard" {
    defaults = { id = "projects/123456789012/dashboards/dash-prod" }
  }
  mock_resource "google_service_account" {
    defaults = {
      email  = "vc-prod-app@demo-project.iam.gserviceaccount.com"
      member = "serviceAccount:vc-prod-app@demo-project.iam.gserviceaccount.com"
      name   = "projects/demo-project/serviceAccounts/vc-prod-app@demo-project.iam.gserviceaccount.com"
    }
  }
  mock_resource "google_logging_project_sink" {
    defaults = { writer_identity = "serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com" }
  }
  mock_resource "google_cloud_run_v2_service" {
    defaults = { name = "vc-prod-app", location = "us-west1" }
  }
}

# A real time_sleep would add two minutes to every apply run.
mock_provider "time" {}

# Only the values the operator has yet to supply fail. alert_email is never
# committed; the operator's terraform.tfvars supplies it, as variables do here.
run "committed_placeholders_fail_validation" {
  command = plan

  variables {
    alert_email = "ops@example.com"
  }

  expect_failures = [var.workos_client_id]
}

# The repository is public: no address in the committed settings.
run "committed_settings_hold_no_email" {
  command = plan

  variables {
    project_id       = "demo-project"
    region           = "us-west1"
    domain           = ""
    workos_client_id = "client_01TEST"
    alert_email      = "ops@example.com"
  }

  assert {
    condition     = length(regexall("[^\\s\"@]+@[^\\s\"@]+", file("${path.module}/prod.auto.tfvars"))) == 0
    error_message = "prod.auto.tfvars must hold no email address: alert_email goes in the gitignored terraform.tfvars"
  }
}

run "no_domain_serves_run_app" {
  command = plan

  variables {
    project_id       = "demo-project"
    region           = "us-west1"
    domain           = ""
    workos_client_id = "client_01TEST"
    alert_email      = "ops@example.com"
  }

  assert {
    condition     = output.app_url == "https://vc-prod-app-123456789012.us-west1.run.app"
    error_message = "run.app URL"
  }
  assert {
    condition     = length(module.edge) == 0 && output.load_balancer_ip == null && output.dns_record == null
    error_message = "no edge without domain"
  }
}

run "domain_adds_edge" {
  command = plan

  variables {
    project_id       = "demo-project"
    region           = "us-west1"
    domain           = "vocalcompass.app"
    workos_client_id = "client_01TEST"
    alert_email      = "ops@example.com"
  }

  assert {
    condition     = output.app_url == "https://vocalcompass.app" && length(module.edge) == 1
    error_message = "domain wiring"
  }
}

run "observability_wired" {
  command = apply

  variables {
    project_id       = "demo-project"
    region           = "us-west1"
    domain           = ""
    workos_client_id = "client_01TEST"
    alert_email      = "ops@example.com"
  }

  assert {
    condition     = module.observability.events_dataset == "demo-project.vc_prod_events"
    error_message = "events dataset wiring"
  }
  assert {
    condition     = output.dashboard_url == "https://console.cloud.google.com/monitoring/dashboards/builder/dash-prod?project=demo-project" && output.events_dataset == "demo-project.vc_prod_events"
    error_message = "env outputs: ${output.dashboard_url}"
  }
}
