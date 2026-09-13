variable "project_id" {
  description = "GCP project the environment lives in."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a GCP project id: 6-30 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "region" {
  description = "Region for Cloud Run and Cloud SQL; the bootstrap registry's region."
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

variable "image" {
  description = "Image the service is first created from. Deploys own it afterwards, and Terraform ignores the drift."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9.-]+/\\S+[:@]\\S+$", var.image))
    error_message = "image must be a full reference such as us-west1-docker.pkg.dev/<project>/vc/app:<tag>."
  }
}

variable "app_base_url" {
  description = "Public origin (https://host, no trailing slash) for OAuth redirects and the Origin check. Empty uses the service's deterministic run.app URL."
  type        = string
  default     = ""

  validation {
    condition     = var.app_base_url == "" || can(regex("^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?$", var.app_base_url))
    error_message = "app_base_url must be empty or https://<host> with no path or trailing slash."
  }
}

variable "workos_client_id" {
  description = "WorkOS client id for this environment (public, not a secret)."
  type        = string

  validation {
    condition     = can(regex("^client_[0-9A-Za-z]+$", var.workos_client_id))
    error_message = "workos_client_id must look like client_01ABC...."
  }
}

variable "auth_allowed_emails" {
  description = "Comma list of emails or @domain entries allowed to sign in. Empty means open signup."
  type        = string
  default     = ""

  validation {
    condition = var.auth_allowed_emails == "" || alltrue([
      for entry in split(",", var.auth_allowed_emails) : can(regex("^[^@\\s]*@[^@\\s]+\\.[^@\\s]+$", trimspace(entry)))
    ])
    error_message = "auth_allowed_emails must be comma-separated emails or @domain entries."
  }
}

variable "min_instances" {
  description = "Instances kept warm. 0 scales to zero: no idle cost, cold starts."
  type        = number
  default     = 0

  validation {
    condition     = var.min_instances >= 0 && var.min_instances == floor(var.min_instances)
    error_message = "min_instances must be a whole number >= 0."
  }
}

variable "max_instances" {
  description = "Instance ceiling. Each instance holds up to 6 Postgres connections (pool 4 + overflow 2); db-f1-micro allows about 25."
  type        = number
  default     = 3

  validation {
    condition     = var.max_instances >= 1 && var.max_instances >= var.min_instances && var.max_instances == floor(var.max_instances)
    error_message = "max_instances must be a whole number >= 1 and >= min_instances."
  }
}

variable "cpu" {
  description = "vCPUs per instance. At least 1, because each instance serves concurrent requests."
  type        = string
  default     = "1"

  validation {
    condition     = contains(["1", "2", "4", "6", "8"], var.cpu)
    error_message = "cpu must be one of 1, 2, 4, 6, 8."
  }
}

variable "memory" {
  description = "Memory per instance."
  type        = string
  # Each of 80 concurrent requests may buffer a 4 MB sync body before the server's 2-slot guard (~320 MB).
  default = "1Gi"

  validation {
    condition     = can(regex("^[0-9]+(Mi|Gi)$", var.memory))
    error_message = "memory must look like 512Mi or 2Gi."
  }
}

variable "database_tier" {
  description = "Cloud SQL machine tier (ENTERPRISE edition)."
  type        = string
  default     = "db-f1-micro"

  validation {
    condition     = can(regex("^db-(f1-micro|g1-small|custom-[0-9]+-[0-9]+)$", var.database_tier))
    error_message = "database_tier must be db-f1-micro, db-g1-small or db-custom-<cpus>-<mb>, the ENTERPRISE edition tiers."
  }
}

variable "deletion_protection" {
  description = "Block deleting the service and the database: Terraform refuses, and Cloud SQL's API refuses too."
  type        = bool
}

variable "ingress" {
  description = "INGRESS_TRAFFIC_ALL, or INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER when an edge load balancer fronts the service."
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"

  validation {
    condition     = contains(["INGRESS_TRAFFIC_ALL", "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"], var.ingress)
    error_message = "ingress must be INGRESS_TRAFFIC_ALL or INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER."
  }
}

variable "deployer_service_account" {
  description = "Email of the bootstrap deployer, granted actAs on this environment's runtime account only."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\\.iam\\.gserviceaccount\\.com$", var.deployer_service_account))
    error_message = "deployer_service_account must be a service account email: <name>@<project>.iam.gserviceaccount.com."
  }
}
