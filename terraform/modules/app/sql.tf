resource "google_sql_database_instance" "this" {
  name                = "${local.name}-sql"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection

  settings {
    # Shared-core tiers such as db-f1-micro exist only in ENTERPRISE; the API
    # would otherwise default to ENTERPRISE_PLUS.
    edition           = "ENTERPRISE"
    tier              = var.database_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    # API-level guard: also blocks deletes from the console and gcloud, which
    # the Terraform-only deletion_protection above does not.
    deletion_protection_enabled = var.deletion_protection

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "10:00" # UTC
    }

    maintenance_window {
      day  = 7  # Sunday
      hour = 11 # UTC
    }

    # A public IP with no authorized networks: only the IAM-gated Cloud SQL
    # connector (Cloud Run's /cloudsql socket) can connect, with no VPC to run.
    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    insights_config {
      query_insights_enabled = true
    }
  }
}

resource "google_sql_database" "vocal" {
  name     = "vocal"
  instance = google_sql_database_instance.this.name
}

resource "random_password" "database" {
  length = 32
  # Embedded verbatim in DATABASE_URL, so nothing that needs URL-encoding.
  special = false
}

resource "google_sql_user" "vocal" {
  name     = "vocal"
  instance = google_sql_database_instance.this.name
  password = random_password.database.result

  # Postgres refuses to drop a role that owns the schema, so a destroy leaves
  # the user to go with the instance instead of failing.
  deletion_policy = "ABANDON"
}
