variable "region" {
  description = "Region of the Cloud Run service the serverless NEG routes to."
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

variable "domain" {
  description = "Hostname to serve, e.g. vocalcompass.app. The certificate provisions once its A record points at ip_address."
  type        = string

  validation {
    condition     = can(regex("^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.domain))
    error_message = "domain must be a lowercase hostname such as vocalcompass.app, without scheme or path."
  }
}

variable "service_name" {
  description = "Cloud Run service the load balancer routes to."
  type        = string

  validation {
    condition     = can(regex("^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$", var.service_name))
    error_message = "service_name must be a Cloud Run service name."
  }
}
