# Non-secret, committed so the state migration and later re-applies use the
# values the first apply did.
project_id = "vocal-compass" # if taken, vocal-compass-<suffix> here and in envs/*/*.auto.tfvars
region     = "us-west1"      # envs/*/*.auto.tfvars must use the same region
