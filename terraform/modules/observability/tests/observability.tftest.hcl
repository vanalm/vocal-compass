mock_provider "google" {
  mock_resource "google_monitoring_dashboard" {
    defaults = { id = "projects/123456789012/dashboards/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0" }
  }
  mock_resource "google_logging_project_sink" {
    defaults = { writer_identity = "serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com" }
  }
  mock_resource "google_monitoring_uptime_check_config" {
    defaults = { uptime_check_id = "vc-staging-api-health-abc123" }
  }
  mock_resource "google_monitoring_notification_channel" {
    defaults = { id = "projects/demo-project/notificationChannels/42" }
  }
}

# A real time_sleep would add two minutes to every apply run.
mock_provider "time" {}

variables {
  project_id          = "demo-project"
  region              = "us-west1"
  environment         = "staging"
  alert_email         = "ops@example.com"
  service_name        = "vc-staging-app"
  sql_instance_name   = "vc-staging-sql"
  uptime_host         = "vc-staging-app-123456789012.us-west1.run.app"
  deletion_protection = false
}

run "staging" {
  command = apply

  assert {
    condition     = output.dashboard_url == "https://console.cloud.google.com/monitoring/dashboards/builder/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0?project=demo-project"
    error_message = "dashboard url: ${output.dashboard_url}"
  }
  assert {
    condition     = output.events_dataset == "demo-project.vc_staging_events"
    error_message = "events dataset"
  }

  # Log-based metrics
  assert {
    condition     = sort([for m in google_logging_metric.counter : m.name]) == sort(["vc_staging_signins", "vc_staging_signups", "vc_staging_client_errors", "vc_staging_server_errors"]) && google_logging_metric.sync_records.name == "vc_staging_sync_records"
    error_message = "metric names"
  }
  assert {
    condition     = google_logging_metric.counter["signins"].filter == "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"vc-staging-app\" AND jsonPayload.event=\"auth.login\""
    error_message = "signins filter: ${google_logging_metric.counter["signins"].filter}"
  }
  assert {
    condition     = google_logging_metric.counter["server_errors"].filter == "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"vc-staging-app\" AND severity>=ERROR AND NOT logName=\"projects/demo-project/logs/run.googleapis.com%2Frequests\""
    error_message = "server_errors filter"
  }
  assert {
    condition     = alltrue([for m in google_logging_metric.counter : m.metric_descriptor[0].metric_kind == "DELTA" && m.metric_descriptor[0].value_type == "INT64" && m.value_extractor == null])
    error_message = "counters are DELTA INT64"
  }
  assert {
    condition     = google_logging_metric.sync_records.value_extractor == "EXTRACT(jsonPayload.accepted)" && google_logging_metric.sync_records.metric_descriptor[0].value_type == "DISTRIBUTION" && google_logging_metric.sync_records.bucket_options[0].exponential_buckets[0].num_finite_buckets == 10 && endswith(google_logging_metric.sync_records.filter, "AND jsonPayload.event=\"sync.completed\"")
    error_message = "sync_records distribution"
  }

  # Alerts
  assert {
    condition     = sort(keys(google_monitoring_alert_policy.this)) == sort(["uptime", "http_5xx", "latency_p95", "server_errors", "client_errors", "sql_cpu", "sql_disk"])
    error_message = "alert set"
  }
  assert {
    condition     = time_sleep.log_metrics.create_duration == "120s" && time_sleep.log_metrics.triggers == tomap({ metrics = "vc_staging_client_errors,vc_staging_server_errors,vc_staging_signins,vc_staging_signups" })
    error_message = "alerts wait for new log metrics, again whenever the counter set changes"
  }
  assert {
    condition = alltrue([for p in google_monitoring_alert_policy.this :
      p.notification_channels == tolist(["projects/demo-project/notificationChannels/42"])
      && p.documentation[0].mime_type == "text/markdown"
      && strcontains(p.documentation[0].content, "Check first:")
      && p.alert_strategy[0].auto_close == "1800s"
      && p.conditions[0].condition_threshold[0].comparison == "COMPARISON_GT"
      && startswith(p.display_name, "vc-staging: ")
    ])
    error_message = "every alert notifies, documents what to check first, and auto-closes"
  }
  assert {
    condition     = strcontains(google_monitoring_alert_policy.this["http_5xx"].documentation[0].content, "update-traffic vc-staging-app --project demo-project --region us-west1")
    error_message = "runbook commands name the project"
  }
  assert {
    condition = (
      google_monitoring_alert_policy.this["http_5xx"].conditions[0].condition_threshold[0].denominator_filter == "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"vc-staging-app\" AND metric.type=\"run.googleapis.com/request_count\""
      && google_monitoring_alert_policy.this["http_5xx"].conditions[0].condition_threshold[0].filter == "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"vc-staging-app\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
      && google_monitoring_alert_policy.this["http_5xx"].conditions[0].condition_threshold[0].denominator_aggregations == google_monitoring_alert_policy.this["http_5xx"].conditions[0].condition_threshold[0].aggregations
      && google_monitoring_alert_policy.this["http_5xx"].conditions[0].condition_threshold[0].threshold_value == 0.02
      && google_monitoring_alert_policy.this["http_5xx"].conditions[0].condition_threshold[0].aggregations[0].alignment_period == "600s"
    )
    error_message = "5xx ratio: numerator/denominator filters and identical aggregations"
  }
  assert {
    condition     = alltrue([for k, p in google_monitoring_alert_policy.this : k == "http_5xx" || (p.conditions[0].condition_threshold[0].denominator_filter == null && length(p.conditions[0].condition_threshold[0].denominator_aggregations) == 0)])
    error_message = "only the ratio alert has a denominator"
  }
  assert {
    condition     = google_monitoring_alert_policy.this["latency_p95"].conditions[0].condition_threshold[0].aggregations[0].per_series_aligner == "ALIGN_DELTA" && google_monitoring_alert_policy.this["latency_p95"].conditions[0].condition_threshold[0].aggregations[0].cross_series_reducer == "REDUCE_PERCENTILE_95" && google_monitoring_alert_policy.this["latency_p95"].conditions[0].condition_threshold[0].threshold_value == 2000
    error_message = "p95 latency"
  }
  assert {
    condition     = strcontains(google_monitoring_alert_policy.this["uptime"].conditions[0].condition_threshold[0].filter, "metric.labels.check_id=\"vc-staging-api-health-abc123\"") && google_monitoring_alert_policy.this["uptime"].conditions[0].condition_threshold[0].duration == "300s" && google_monitoring_alert_policy.this["uptime"].conditions[0].condition_threshold[0].evaluation_missing_data == null
    error_message = "uptime alert targets the check and waits 5 minutes"
  }
  assert {
    condition     = strcontains(google_monitoring_alert_policy.this["server_errors"].conditions[0].condition_threshold[0].filter, "metric.type=\"logging.googleapis.com/user/vc_staging_server_errors\"") && strcontains(google_monitoring_alert_policy.this["client_errors"].conditions[0].condition_threshold[0].filter, "metric.type=\"logging.googleapis.com/user/vc_staging_client_errors\"") && google_monitoring_alert_policy.this["client_errors"].conditions[0].condition_threshold[0].threshold_value == 20
    error_message = "log alerts use user-defined metric types"
  }
  assert {
    condition     = google_monitoring_alert_policy.this["server_errors"].conditions[0].condition_threshold[0].evaluation_missing_data == "EVALUATION_MISSING_DATA_INACTIVE" && google_monitoring_alert_policy.this["sql_cpu"].conditions[0].condition_threshold[0].evaluation_missing_data == null
    error_message = "missing data closes error alerts only"
  }
  assert {
    condition     = strcontains(google_monitoring_alert_policy.this["sql_cpu"].conditions[0].condition_threshold[0].filter, "resource.labels.database_id=\"demo-project:vc-staging-sql\"") && google_monitoring_alert_policy.this["sql_cpu"].conditions[0].condition_threshold[0].duration == "900s" && google_monitoring_alert_policy.this["sql_cpu"].conditions[0].condition_threshold[0].aggregations[0].cross_series_reducer == null && google_monitoring_alert_policy.this["sql_disk"].conditions[0].condition_threshold[0].threshold_value == 0.85
    error_message = "Cloud SQL alerts"
  }

  # Uptime check
  assert {
    condition = (
      google_monitoring_uptime_check_config.health.monitored_resource[0].type == "uptime_url"
      && google_monitoring_uptime_check_config.health.monitored_resource[0].labels == tomap({ project_id = "demo-project", host = "vc-staging-app-123456789012.us-west1.run.app" })
      && length(google_monitoring_uptime_check_config.health.selected_regions) == 3
      && google_monitoring_uptime_check_config.health.http_check[0].path == "/api/health"
      && google_monitoring_uptime_check_config.health.http_check[0].use_ssl
      && google_monitoring_uptime_check_config.health.http_check[0].validate_ssl
      && google_monitoring_uptime_check_config.health.content_matchers[0].content == "\"status\":\"ok\""
    )
    error_message = "uptime check"
  }

  # BigQuery event sink
  assert {
    condition     = google_bigquery_dataset.events.dataset_id == "vc_staging_events" && google_bigquery_dataset.events.location == "us-west1" && google_bigquery_dataset.events.default_partition_expiration_ms == 400 * 86400000 && google_bigquery_dataset.events.delete_contents_on_destroy == true
    error_message = "dataset"
  }
  assert {
    condition     = google_logging_project_sink.events.destination == "bigquery.googleapis.com/projects/demo-project/datasets/vc_staging_events" && google_logging_project_sink.events.filter == "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"vc-staging-app\" AND jsonPayload.event:*" && google_logging_project_sink.events.unique_writer_identity && google_logging_project_sink.events.bigquery_options[0].use_partitioned_tables
    error_message = "sink"
  }
  assert {
    condition     = google_bigquery_dataset_iam_member.sink_writer.member == "serviceAccount:service-123456789012@gcp-sa-logging.iam.gserviceaccount.com" && google_bigquery_dataset_iam_member.sink_writer.role == "roles/bigquery.dataEditor" && google_bigquery_dataset_iam_member.sink_writer.dataset_id == "vc_staging_events"
    error_message = "sink writer grant"
  }

  # Dashboard layout
  assert {
    condition     = jsondecode(google_monitoring_dashboard.this.dashboard_json).mosaicLayout.columns == 48 && length(jsondecode(google_monitoring_dashboard.this.dashboard_json).mosaicLayout.tiles) == 8
    error_message = "8 tiles on a 48-column grid"
  }
  assert {
    condition     = alltrue([for t in jsondecode(google_monitoring_dashboard.this.dashboard_json).mosaicLayout.tiles : try(t.xPos, 0) + t.width <= 48 && t.height > 0 && try(t.xPos, 1) != 0 && try(t.yPos, 1) != 0])
    error_message = "tiles fit the grid and never write a zero position"
  }
  assert {
    condition     = length(distinct([for t in jsondecode(google_monitoring_dashboard.this.dashboard_json).mosaicLayout.tiles : "${try(t.xPos, 0)},${try(t.yPos, 0)}"])) == 8
    error_message = "tiles do not overlap"
  }
  assert {
    condition     = !strcontains(google_monitoring_dashboard.this.dashboard_json, "null")
    error_message = "no null fields in dashboard JSON"
  }
}

run "prod_keeps_event_history" {
  command = plan

  variables {
    environment             = "prod"
    service_name            = "vc-prod-app"
    sql_instance_name       = "vc-prod-sql"
    uptime_host             = "vocalcompass.app"
    deletion_protection     = true
    bigquery_retention_days = 30
  }

  assert {
    condition     = google_bigquery_dataset.events.delete_contents_on_destroy == false && google_bigquery_dataset.events.default_partition_expiration_ms == 2592000000
    error_message = "prod dataset"
  }
  assert {
    condition     = google_monitoring_uptime_check_config.health.monitored_resource[0].labels["host"] == "vocalcompass.app" && google_logging_metric.counter["signups"].name == "vc_prod_signups"
    error_message = "prod naming and host"
  }
}

run "rejects_bad_inputs" {
  command = plan

  variables {
    uptime_host             = "https://vocalcompass.app"
    sql_instance_name       = "demo-project:us-west1:vc-staging-sql"
    bigquery_retention_days = 0
    alert_email             = "REPLACE-ME"
  }

  expect_failures = [var.uptime_host, var.sql_instance_name, var.bigquery_retention_days, var.alert_email]
}
