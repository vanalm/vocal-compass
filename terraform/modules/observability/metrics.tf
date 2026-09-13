# Log-based metrics: the app logs domain events as JSON lines with an `event`
# field, and these turn the ones worth charting or alerting on into time series
# (metric type logging.googleapis.com/user/<name>).

locals {
  counters = {
    signins       = "jsonPayload.event=\"auth.login\""
    signups       = "jsonPayload.event=\"auth.signup\""
    client_errors = "jsonPayload.event=\"client.error\""

    # The app's errors and the platform's (a revision that fails to start, a
    # crashed instance). Cloud Run's request log marks every 5xx response ERROR
    # too; the 5xx ratio alert owns those, so one bad request does not page twice.
    server_errors = "severity>=ERROR AND NOT logName=\"projects/${var.project_id}/logs/run.googleapis.com%2Frequests\""
  }
}

resource "google_logging_metric" "counter" {
  for_each = local.counters

  name   = "vc_${var.environment}_${each.key}"
  filter = "${local.service} AND ${each.value}"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }
}

# Records newly stored per sync, as a distribution: steady small pushes are
# devices keeping up; large ones are first sign-ins uploading local history.
resource "google_logging_metric" "sync_records" {
  name            = "vc_${var.environment}_sync_records"
  filter          = "${local.service} AND jsonPayload.event=\"sync.completed\""
  value_extractor = "EXTRACT(jsonPayload.accepted)"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "1"
  }

  # Buckets [1,2), [2,4) ... [512,1024) span the 500-record push cap; a sync
  # that stored nothing lands in the underflow bucket.
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 10
      growth_factor      = 2
      scale              = 1
    }
  }
}
