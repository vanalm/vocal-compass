# Every domain event, kept queryable in SQL. Cloud Logging creates the table
# (run_googleapis_com_stdout, partitioned by day on timestamp) on the first
# matching entry, and adds a column the first time an event carries a new field.

resource "google_bigquery_dataset" "events" {
  dataset_id  = "vc_${var.environment}_events"
  location    = var.region
  description = "Vocal Compass ${var.environment} domain events, routed from Cloud Logging."

  # Inherited by the partitioned table Logging creates: old days drop off.
  default_partition_expiration_ms = var.bigquery_retention_days * 24 * 60 * 60 * 1000

  # The sink's tables are not in Terraform state, so without this a destroy
  # fails on a non-empty dataset.
  delete_contents_on_destroy = !var.deletion_protection
}

resource "google_logging_project_sink" "events" {
  name        = "${local.name}-events"
  destination = "bigquery.googleapis.com/projects/${var.project_id}/datasets/${google_bigquery_dataset.events.dataset_id}"
  filter      = "${local.service} AND jsonPayload.event:*"

  unique_writer_identity = true

  bigquery_options {
    use_partitioned_tables = true
  }
}

resource "google_bigquery_dataset_iam_member" "sink_writer" {
  dataset_id = google_bigquery_dataset.events.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = google_logging_project_sink.events.writer_identity
}
