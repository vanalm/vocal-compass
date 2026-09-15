# Non-secret production settings, committed so every machine plans the same
# thing. Secrets never go here: the WorkOS API key is a Secret Manager version.
# The repository is public, so alert_email lives in the gitignored terraform.tfvars.
project_id       = "vocal-compass" # same as bootstrap
region           = "us-west1"      # must match bootstrap
domain           = ""              # run.app URL until a domain is chosen; a domain adds the load balancer
workos_client_id = "REPLACE-ME"    # TODO(operator): WorkOS production client id (client_...)
