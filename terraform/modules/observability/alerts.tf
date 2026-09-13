# One entry per alert: what it watches, when it fires, and what to check first.
# Every policy emails the same channel and closes itself 30 minutes after the
# condition clears. Thresholds are "above": comparison is always COMPARISON_GT.
#
# Ratios use a threshold condition with denominator_filter rather than MQL
# (deprecated) or PromQL: the filters are the same Monitoring filters the log
# metrics and dashboard use, with no metric-name translation.

locals {
  request_count = "${local.service} AND metric.type=\"run.googleapis.com/request_count\""
  user_metric   = { for key, metric in google_logging_metric.counter : key => "${local.service} AND metric.type=\"logging.googleapis.com/user/${metric.name}\"" }

  # window: alignment period in seconds. duration: how long the aligned value
  # must stay above threshold. absent_is_healthy: the series only exists while
  # something is wrong (errors, traffic), so no data means resolved.
  alerts = {
    uptime = {
      title    = "/api/health failing"
      severity = "CRITICAL"
      filter   = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.health.uptime_check_id}\""
      # Each location's latest result, counting the failing locations.
      aligner           = "ALIGN_NEXT_OLDER"
      reducer           = "REDUCE_COUNT_FALSE"
      group_by          = ["resource.label.host"]
      denominator       = null
      window            = 1200
      threshold         = 1
      duration          = 300
      absent_is_healthy = false
      runbook           = <<-EOT
        More than one checker location has failed `https://${var.uptime_host}/api/health` for 5 minutes.

        Check first: open that URL yourself. A certificate error in the first hour after setting a domain means the managed certificate is still provisioning (the A record must be DNS-only). Otherwise open the service in Cloud Run: a latest revision that failed to start is a bad deploy or a failed migration. The uptime check's failure logs give each probe's reason.
      EOT
    }

    http_5xx = {
      title             = "5xx responses above 2%"
      severity          = "CRITICAL"
      filter            = "${local.request_count} AND metric.labels.response_code_class=\"5xx\""
      aligner           = "ALIGN_DELTA"
      reducer           = "REDUCE_SUM"
      group_by          = ["resource.label.service_name"]
      denominator       = local.request_count
      window            = 600
      threshold         = 0.02
      duration          = 0
      absent_is_healthy = true
      runbook           = <<-EOT
        More than 2% of `${var.service_name}` responses in the last 10 minutes were 5xx.

        Check first: Error Reporting for a new exception group, then Logs Explorer: `${local.service} AND severity>=ERROR`. If it began with a deploy, roll back: `gcloud run services update-traffic ${var.service_name} --project ${var.project_id} --region ${var.region} --to-revisions <previous-revision>=100`. 503s without app errors mean instances or database connections ran out: compare instance count with max_instances on the dashboard.
      EOT
    }

    latency_p95 = {
      title    = "p95 latency above 2s"
      severity = "ERROR"
      filter   = "${local.service} AND metric.type=\"run.googleapis.com/request_latencies\""
      # Merges every revision's latency distribution before taking the 95th
      # percentile, so it is the service's p95, not the worst series'.
      aligner           = "ALIGN_DELTA"
      reducer           = "REDUCE_PERCENTILE_95"
      group_by          = ["resource.label.service_name"]
      denominator       = null
      window            = 600
      threshold         = 2000 # ms
      duration          = 0
      absent_is_healthy = true
      runbook           = <<-EOT
        The 95th percentile of `${var.service_name}` request latency over the last 10 minutes is above 2 seconds.

        Check first: Cloud SQL CPU and connections on the dashboard (db-f1-micro saturates first; Query Insights shows the slow queries), then whether the instance count sits at max_instances so requests queue. The request log's latency field shows which paths are slow.
      EOT
    }

    server_errors = {
      title             = "server errors logged"
      severity          = "ERROR"
      filter            = local.user_metric.server_errors
      aligner           = "ALIGN_DELTA"
      reducer           = "REDUCE_SUM"
      group_by          = ["resource.label.service_name"]
      denominator       = null
      window            = 300
      threshold         = 0
      duration          = 0
      absent_is_healthy = true
      runbook           = <<-EOT
        `${var.service_name}` or Cloud Run logged at severity ERROR or above in the last 5 minutes.

        Check first: Error Reporting, which groups the app's exceptions with stack traces. If it has nothing new, Logs Explorer `${local.service} AND severity>=ERROR` shows platform failures: a revision whose migration or startup probe failed (the previous revision keeps serving), or a crashed instance.
      EOT
    }

    client_errors = {
      title             = "client error spike"
      severity          = "WARNING"
      filter            = local.user_metric.client_errors
      aligner           = "ALIGN_DELTA"
      reducer           = "REDUCE_SUM"
      group_by          = ["resource.label.service_name"]
      denominator       = null
      window            = 600
      threshold         = 20
      duration          = 0
      absent_is_healthy = true
      runbook           = <<-EOT
        Browsers reported more than 20 errors to `/api/telemetry/errors` in 10 minutes.

        Check first: the `jsonPayload.event="client.error"` log lines, grouped by message and release. A spike that starts with a deploy points at that release; one confined to a single browser points at a compatibility bug.
      EOT
    }

    sql_cpu = {
      title             = "Cloud SQL CPU above 80%"
      severity          = "WARNING"
      filter            = "${local.sql} AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
      aligner           = "ALIGN_MEAN"
      reducer           = null
      group_by          = []
      denominator       = null
      window            = 300
      threshold         = 0.8
      duration          = 900
      absent_is_healthy = false
      runbook           = <<-EOT
        `${var.sql_instance_name}` CPU has stayed above 80% for 15 minutes.

        Check first: Query Insights for the queries using it, then the dashboard for whether traffic grew with it. A sustained rise with traffic means the tier is too small: raise database_tier (db-f1-micro is shared-core).
      EOT
    }

    sql_disk = {
      title             = "Cloud SQL disk above 85%"
      severity          = "WARNING"
      filter            = "${local.sql} AND metric.type=\"cloudsql.googleapis.com/database/disk/utilization\""
      aligner           = "ALIGN_MEAN"
      reducer           = null
      group_by          = []
      denominator       = null
      window            = 300
      threshold         = 0.85
      duration          = 300
      absent_is_healthy = false
      runbook           = <<-EOT
        `${var.sql_instance_name}` disk is more than 85% full.

        Check first: whether storage autoresize is keeping up (Cloud SQL, Overview, Storage). Then find what grew: `SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;`
      EOT
    }
  }
}

# Monitoring learns of a new log-based metric some time after Logging creates
# it, and until then refuses an alert that filters on it ("The metric referenced
# by the provided filter is unknown"), which the provider does not retry. So
# alerts wait, on the first apply and again whenever a counter is added.
resource "time_sleep" "log_metrics" {
  create_duration = "120s"
  triggers        = { metrics = join(",", sort([for metric in google_logging_metric.counter : metric.name])) }
}

resource "google_monitoring_alert_policy" "this" {
  for_each = local.alerts

  display_name          = "${local.name}: ${each.value.title}"
  severity              = each.value.severity
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email.id]

  conditions {
    display_name = each.value.title

    condition_threshold {
      filter                  = each.value.filter
      denominator_filter      = each.value.denominator
      comparison              = "COMPARISON_GT"
      threshold_value         = each.value.threshold
      duration                = "${each.value.duration}s"
      evaluation_missing_data = each.value.absent_is_healthy ? "EVALUATION_MISSING_DATA_INACTIVE" : null

      aggregations {
        alignment_period     = "${each.value.window}s"
        per_series_aligner   = each.value.aligner
        cross_series_reducer = each.value.reducer
        group_by_fields      = each.value.group_by
      }

      # A ratio's two sides must be aligned and grouped identically.
      dynamic "denominator_aggregations" {
        for_each = each.value.denominator == null ? [] : [each.value]

        content {
          alignment_period     = "${denominator_aggregations.value.window}s"
          per_series_aligner   = denominator_aggregations.value.aligner
          cross_series_reducer = denominator_aggregations.value.reducer
          group_by_fields      = denominator_aggregations.value.group_by
        }
      }

      trigger {
        count = 1
      }
    }
  }

  documentation {
    content   = each.value.runbook
    mime_type = "text/markdown"
  }

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [time_sleep.log_metrics]
}
