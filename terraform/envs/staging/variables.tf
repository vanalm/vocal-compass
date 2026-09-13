variable "project_id" {
  description = "GCP project hosting Vocal Compass (the one bootstrap was applied to)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a GCP project id: 6-30 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "region" {
  description = "Region to deploy to; must match bootstrap's, where the image registry lives."
  type        = string

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+$", var.region))
    error_message = "region must be a GCP region such as us-west1."
  }
}

variable "domain" {
  description = "Hostname to serve behind the load balancer, or empty to serve on the run.app URL with no load balancer."
  type        = string

  validation {
    condition     = var.domain == "" || can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.domain))
    error_message = "domain must be empty or a lowercase hostname such as vocalcompass.app, without scheme or path."
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
}

variable "alert_email" {
  description = "Address that receives monitoring alerts. Set it in the gitignored terraform.tfvars, never a committed file: the repository is public."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be an email address."
  }
}

variable "image" {
  description = "Image the service is first created from. Empty means <region>-docker.pkg.dev/<project_id>/vc/app:bootstrap. Deploys own the image afterwards."
  type        = string
  default     = ""
}
