variable "project_id" {
  description = "GCP project hosting every Vocal Compass environment."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a GCP project id: 6-30 lowercase letters, digits or hyphens, starting with a letter."
  }
}

variable "region" {
  description = "Region for the state bucket and image registry. Envs must deploy to the same region."
  type        = string

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]+$", var.region))
    error_message = "region must be a GCP region such as us-west1."
  }
}

# Both ids: gh api repos/vanalm/vocal-compass --jq '.id, .owner.id'
variable "github_repository_id" {
  description = "Numeric id of the only GitHub repository (vanalm/vocal-compass) whose main branch may deploy. Unlike owner/name, no one else can ever hold it."
  type        = string
  default     = "1341356300"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must be a numeric repository id, not owner/name."
  }
}

variable "github_repository_owner_id" {
  description = "Numeric id of that repository's owner (vanalm). Moving the repository to another account changes it."
  type        = string
  default     = "51979670"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_owner_id))
    error_message = "github_repository_owner_id must be a numeric account id, not a login."
  }
}

variable "environments" {
  description = "Environments that get a vc-<env>-workos-api-key secret container."
  type        = set(string)
  default     = ["staging", "prod"]

  validation {
    condition     = length(var.environments) > 0 && alltrue([for env in var.environments : contains(["staging", "prod"], env)])
    error_message = "environments may only contain staging and prod, the names envs/ and modules/app use."
  }
}
