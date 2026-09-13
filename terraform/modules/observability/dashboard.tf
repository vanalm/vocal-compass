# One screen per environment: traffic and errors, latency, capacity, product
# events, and the database. Add a chart by appending to local.charts; tiles are
# laid out two per row.

locals {
  chart_filter = {
    requests      = local.request_count
    latencies     = "${local.service} AND metric.type=\"run.googleapis.com/request_latencies\""
    instances     = "${local.service} AND metric.type=\"run.googleapis.com/container/instance_count\""
    signins       = local.user_metric.signins
    signups       = local.user_metric.signups
    sync_records  = "${local.service} AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.sync_records.name}\""
    client_errors = local.user_metric.client_errors
    server_errors = local.user_metric.server_errors
    sql_cpu       = "${local.sql} AND metric.type=\"cloudsql.googleapis.com/database/cpu/utilization\""
    sql_backends  = "${local.sql} AND metric.type=\"cloudsql.googleapis.com/database/postgresql/num_backends\""
  }

  # Sums a counter per alignment period across revisions and instances.
  per_minute = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_DELTA", crossSeriesReducer = "REDUCE_SUM" }
  per_hour   = merge(local.per_minute, { alignmentPeriod = "3600s" })

  charts = [
    {
      title = "Requests per minute by response class"
      xyChart = { dataSets = [{
        plotType        = "STACKED_BAR"
        timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.requests, aggregation = merge(local.per_minute, { groupByFields = ["metric.label.response_code_class"] }) } }
      }] }
    },
    {
      # The same ratio, over the same 10-minute window, that the 5xx alert watches.
      title = "5xx share of responses (alert above 2%)"
      xyChart = {
        dataSets = [{
          plotType = "LINE"
          timeSeriesQuery = { timeSeriesFilterRatio = {
            numerator   = { filter = "${local.chart_filter.requests} AND metric.labels.response_code_class=\"5xx\"", aggregation = merge(local.per_minute, { alignmentPeriod = "600s" }) }
            denominator = { filter = local.chart_filter.requests, aggregation = merge(local.per_minute, { alignmentPeriod = "600s" }) }
          } }
        }]
        thresholds = [{ value = 0.02 }]
      }
    },
    {
      title = "p95 latency, ms (alert above 2000)"
      xyChart = {
        dataSets = [{
          plotType        = "LINE"
          timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.latencies, aggregation = merge(local.per_minute, { crossSeriesReducer = "REDUCE_PERCENTILE_95" }) } }
        }]
        thresholds = [{ value = 2000 }]
      }
    },
    {
      title = "Instances"
      xyChart = { dataSets = [{
        plotType        = "STACKED_AREA"
        timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.instances, aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MAX", crossSeriesReducer = "REDUCE_SUM", groupByFields = ["metric.label.state"] } } }
      }] }
    },
    {
      title = "Sign-ins and sign-ups per hour"
      xyChart = { dataSets = [
        { plotType = "LINE", legendTemplate = "sign-ins", timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.signins, aggregation = local.per_hour } } },
        { plotType = "LINE", legendTemplate = "sign-ups", timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.signups, aggregation = local.per_hour } } },
      ] }
    },
    {
      title = "Records stored per sync"
      xyChart = { dataSets = [{
        plotType        = "HEATMAP"
        timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.sync_records, aggregation = local.per_hour } }
      }] }
    },
    {
      title = "Errors per minute"
      xyChart = { dataSets = [
        { plotType = "LINE", legendTemplate = "client reports", timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.client_errors, aggregation = local.per_minute } } },
        { plotType = "LINE", legendTemplate = "server error logs", timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.server_errors, aggregation = local.per_minute } } },
      ] }
    },
    {
      title = "Cloud SQL CPU and connections"
      xyChart = {
        dataSets = [
          { plotType = "LINE", legendTemplate = "CPU", timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.sql_cpu, aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN" } } } },
          { plotType = "LINE", legendTemplate = "connections", targetAxis = "Y2", timeSeriesQuery = { timeSeriesFilter = { filter = local.chart_filter.sql_backends, aggregation = { alignmentPeriod = "60s", perSeriesAligner = "ALIGN_MEAN", crossSeriesReducer = "REDUCE_SUM" } } } },
        ]
        y2Axis = { label = "connections", scale = "LINEAR" }
      }
    },
  ]

  tile_width  = 24 # of the layout's 48 columns
  tile_height = 16
}

resource "google_monitoring_dashboard" "this" {
  dashboard_json = jsonencode({
    displayName = "Vocal Compass ${var.environment}"
    mosaicLayout = {
      columns = 48
      # The API omits zero-valued fields and the provider compares JSON
      # literally, so writing xPos = 0 or yPos = 0 would show a diff on every plan.
      tiles = [for i, chart in local.charts : merge(
        { width = local.tile_width, height = local.tile_height, widget = chart },
        i % 2 == 0 ? {} : { xPos = local.tile_width },
        i < 2 ? {} : { yPos = floor(i / 2) * local.tile_height },
      )]
    }
  })
}
