variable "project_id" {
  description = "GCP project the environment lives in."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a GCP project id: 6-30 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "region" {
  description = "Region the service runs in; the events dataset is stored there too."
  type        = string

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+$", var.region))
    error_message = "region must be a GCP region such as us-west1."
  }
}

variable "environment" {
  description = "Environment name; resources are named vc-<environment>-<thing>."
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be staging or prod."
  }
}

variable "alert_email" {
  description = "Address that receives monitoring alerts."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be an email address."
  }
}

variable "service_name" {
  description = "Cloud Run service whose metrics and logs are watched."
  type        = string

  validation {
    condition     = can(regex("^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$", var.service_name))
    error_message = "service_name must be a Cloud Run service name."
  }
}

variable "sql_instance_name" {
  description = "Cloud SQL instance whose CPU and disk are watched."
  type        = string

  validation {
    condition     = can(regex("^[a-z]([a-z0-9-]{0,96}[a-z0-9])?$", var.sql_instance_name))
    error_message = "sql_instance_name must be a Cloud SQL instance name (not the project:region:instance connection name)."
  }
}

variable "uptime_host" {
  description = "Host the uptime check requests https://<host>/api/health from: the domain, or the run.app host when there is none."
  type        = string

  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.uptime_host))
    error_message = "uptime_host must be a bare hostname, without scheme or path."
  }
}

variable "bigquery_retention_days" {
  description = "Days each daily partition of domain events is kept in BigQuery."
  type        = number
  default     = 400

  validation {
    condition     = var.bigquery_retention_days >= 1 && var.bigquery_retention_days == floor(var.bigquery_retention_days)
    error_message = "bigquery_retention_days must be a whole number >= 1."
  }
}

variable "deletion_protection" {
  description = "Keep event history on destroy: the events dataset refuses deletion while it holds tables."
  type        = bool
}
