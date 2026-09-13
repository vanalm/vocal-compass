# Terraform

Vocal Compass on Google Cloud: one project, two environments (`staging`, `prod`).
An operator applies Terraform; CI only runs `fmt`, `validate` and the tests, and
the deploy workflow ships images, never infrastructure.

## What gets built

```
bootstrap (once)  APIs · state bucket <project>-vc-tfstate · Artifact Registry vc
                  WIF pool vc-github → SA vc-deployer · secrets vc-<env>-workos-api-key

each env          browser
                    │ domain set: Cloudflare A record (DNS only) → static IP
                    │   → HTTPS load balancer + managed cert + Cloud CDN (:80 redirects)
                    │ no domain:  https://vc-<env>-app-<project-number>.<region>.run.app
                    ▼
                  Cloud Run vc-<env>-app  (SPA + /api, runs as SA vc-<env>-app)
                    │ /cloudsql socket        │ secret env vars
                    ▼                         ▼
                  Cloud SQL vc-<env>-sql    Secret Manager vc-<env>-database-url,
                  (Postgres 16, PITR)       -workos-cookie-password, -workos-api-key

                  stdout JSON → Cloud Logging ─┬→ log metrics ─→ 7 alerts → email
                                               ├→ dashboard
                                               └→ sink → BigQuery vc_<env>_events
                  uptime check, 3 regions → https://<host>/api/health
```

## Layout

| Path | Holds |
|---|---|
| `bootstrap/` | once per project; local state first, then migrated into the bucket it creates |
| `modules/app/` | Cloud Run service, Cloud SQL, generated secrets, runtime service account |
| `modules/edge/` | load balancer, certificate, CDN, HTTP→HTTPS redirect (only when `domain` is set) |
| `modules/observability/` | alerts, uptime check, log-based metrics, dashboard, BigQuery event sink |
| `envs/staging/`, `envs/prod/` | one root each: app + edge (if domain) + observability |

## Conventions

- **Names:** `vc-<env>-<thing>`; `vc_<env>_<thing>` where hyphens are not allowed (log metrics, BigQuery).
- **Settings:** committed `*.auto.tfvars` hold non-secret values, so every machine plans the same. Other `*.tfvars` are gitignored. `REPLACE-ME` placeholders fail validation until set.
- **Secrets:** Terraform owns the inventory: each secret container and its accessor grant. It generates `DATABASE_URL` and the cookie password, whose values live in state in the private bucket. The WorkOS API key's value is added with `gcloud` and never appears in config or state; an env refuses to plan until it exists.
- **Image:** Terraform creates each service from `app:bootstrap`, then ignores the image. `deploy.yml` owns it: a push to `main` ships once CI passes on it. The registry keeps the 20 newest images and `app:bootstrap`, which recreating a service needs; other images go after 90 days, untagged ones after 14.
- **Protection:** in prod, `deletion_protection = true` guards Cloud Run, Cloud SQL (in Terraform and in the API) and the events dataset. Staging has none.
- **Deploy identity:** only a workflow running on `main` of the repository whose ids are `github_repository_id` and `github_repository_owner_id` (`bootstrap/variables.tf`) can act as `vc-deployer`. Ids, unlike `owner/name`, cannot be registered by someone else after a rename or deletion. Moving the repository to another account changes the owner id: update it and apply bootstrap.
- **Tests:** each root and module has `tests/*.tftest.hcl` against mocked providers, which need no credentials: `terraform init -backend=false && terraform test` in that directory. CI runs them all.

## First deploy

Prerequisites: `gcloud`, `terraform` >= 1.9, `docker`, `gh`, and a project with billing. The committed project id is `vocal-compass`; if that id is taken, choose one such as `vocal-compass-<suffix>` and set it as `project_id` in `bootstrap/bootstrap.auto.tfvars` and `envs/*/*.auto.tfvars`.

```sh
gcloud projects create <project_id>
gcloud billing projects link <project_id> --billing-account=<billing_account_id>
gcloud auth login && gcloud auth application-default login
```

Every `gcloud` command below passes `--project`, so the machine's default project, which other stacks may rely on, is left alone. On a fresh machine only: if bootstrap fails asking for a quota project, run `gcloud auth application-default set-quota-project <project_id>`.

Replace every `REPLACE-ME` in `envs/*/*.auto.tfvars`: prod's `domain` (or `""` to serve on run.app), and each WorkOS client id (step 2). Use the same `region` everywhere.

The repository is public, so the alert address goes in each env's gitignored `terraform.tfvars`: `echo 'alert_email = "<email>"' > terraform/envs/<env>/terraform.tfvars`.

1. **Bootstrap** on local state, then move the state into the bucket it created:
   ```sh
   cd terraform/bootstrap
   echo 'terraform { backend "local" {} }' > backend_override.tf
   terraform init && terraform apply
   rm backend_override.tf
   terraform init -migrate-state -backend-config="bucket=<project_id>-vc-tfstate"
   ```
2. **WorkOS**, for each env: the WorkOS Staging environment for `staging`, Production for `prod`. `<app_url>` is `https://<domain>`, else `https://vc-<env>-app-<project_number>.<region>.run.app` (`gcloud projects describe <project_id> --format='value(projectNumber)'`).
   - [ ] **Redirects:** redirect URI `<app_url>/api/auth/callback`.
   - [ ] **Redirects:** sign-out (logout) redirect `<app_url>`. The server calls `get_logout_url()` without `return_to` (`WorkOSProvider.logout_url`, `server/vocal_compass/auth/providers.py`), so WorkOS sends the browser here.
   - [ ] **Redirects:** app homepage URL, if the dashboard asks: `<app_url>`.
   - [ ] **API Keys:** copy the Client ID into `workos_client_id` in `envs/<env>/<env>.auto.tfvars`. It is not secret.
   - [ ] **API Keys:** create an API key and add it here, where it never reaches shell history or a file:
     ```sh
     read -rs KEY && printf %s "$KEY" | gcloud secrets versions add vc-<env>-workos-api-key --project <project_id> --data-file=- && unset KEY
     ```
3. **First image**, which each service is created from. Run from the repo root:
   ```sh
   gcloud auth configure-docker <region>-docker.pkg.dev
   docker build --platform linux/amd64 -t <region>-docker.pkg.dev/<project_id>/vc/app:bootstrap .
   docker push <region>-docker.pkg.dev/<project_id>/vc/app:bootstrap
   ```
4. **Environments**, staging first:
   ```sh
   cd terraform/envs/staging
   terraform init -backend-config="bucket=<project_id>-vc-tfstate"
   terraform apply
   cd ../prod && terraform init -backend-config="bucket=<project_id>-vc-tfstate" && terraform apply
   ```
   The first apply of each env waits two minutes before creating the alerts, until Monitoring knows its new log-based metrics.
5. **DNS** (only for an env with a domain): at Cloudflare, create the `dns_record` output, an `A` record from the domain to `load_balancer_ip`. Set it to **DNS only** (grey cloud): a proxied record hides the IP, and the certificate never provisions.
6. **Certificate:** it provisions 15-60 minutes after DNS resolves. Until then HTTPS fails, and the uptime alert may fire and later close itself.
   ```sh
   gcloud compute ssl-certificates list --project <project_id> --format="table(name,managed.status,managed.domainStatus)"
   ```
7. **GitHub**, only now (a deploy before step 4 would create the services outside Terraform). Create the Environment `production` with required reviewers and deployments limited to `main`, then:
   ```sh
   gh variable set GCP_PROJECT_ID --body <project_id>
   gh variable set GCP_REGION --body <region>
   gh variable set GCP_WIF_PROVIDER --body "$(terraform -chdir=terraform/bootstrap output -raw workload_identity_provider)"
   gh variable set GCP_DEPLOYER_SA --body "$(terraform -chdir=terraform/bootstrap output -raw deployer_service_account)"
   gh variable set STAGING_URL --body "$(terraform -chdir=terraform/envs/staging output -raw app_url)"
   gh variable set PROD_URL --body "$(terraform -chdir=terraform/envs/prod output -raw app_url)"
   ```

## Day 2

**Change infrastructure:** edit, then run `terraform plan` and `terraform apply` in the env directory. `terraform output dashboard_url` links the dashboard.

**Scale:** set `min_instances`, `max_instances`, `cpu`, `memory` or `database_tier` in the `module "app"` block of `envs/<env>/main.tf`, then apply. Each instance holds up to 6 Postgres connections and db-f1-micro allows about 25, so keep `max_instances` at 3 unless you raise the tier. A tier change restarts the database, which is a few minutes of downtime.

**Rotate the cookie password.** This signs everyone out. Replace the secret, then roll a revision so no instance keeps the old value:
```sh
terraform apply -replace=module.app.random_bytes.cookie
gcloud run deploy vc-prod-app --project <project_id> --region <region> \
  --image "$(gcloud run services describe vc-prod-app --project <project_id> --region <region> --format='value(spec.template.spec.containers[0].image)')"
```

**Restore from point-in-time recovery.** Cloud SQL restores a point in time into a new instance, a copy with the same `vocal` user and password:
```sh
gcloud sql instances clone vc-prod-sql vc-prod-sql-restore --project <project_id> --point-in-time=2026-09-01T12:00:00Z
```
Connect with `cloud-sql-proxy <project_id>:<region>:vc-prod-sql-restore` and copy the lost rows back with `pg_dump`/`psql`. Then run `gcloud sql instances delete vc-prod-sql-restore --project <project_id>` (if the clone inherited deletion protection, first run `gcloud sql instances patch vc-prod-sql-restore --project <project_id> --no-deletion-protection`). To roll the whole database back instead, use `gcloud sql backups list --project <project_id> --instance=vc-prod-sql`, then `gcloud sql backups restore <backup_id> --project <project_id> --restore-instance=vc-prod-sql`. This overwrites everything written since that backup.

**Logs and events.** Recent events:
```sh
gcloud logging read --project <project_id> 'resource.labels.service_name="vc-prod-app" AND jsonPayload.event="sync.completed"' --freshness=1h --limit=20
```
Every event is also in BigQuery (`events_dataset` output). The table appears with the first event, and daily partitions expire after `bigquery_retention_days` (default 400):
```sql
SELECT DATE(timestamp) AS day, jsonPayload.event AS event, COUNT(*) AS n
FROM `<project_id>.vc_prod_events.run_googleapis_com_stdout`
WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY day, event
ORDER BY day DESC, n DESC
```

**Destroy.** `terraform destroy` removes staging. Its Cloud SQL instance name stays reserved for about a week. Prod refuses: set `deletion_protection = false` in both module blocks of `envs/prod/main.tf`, apply, then destroy. Bootstrap (state bucket, registry, deploy identity) outlives both.

## Costs

Monthly list prices in USD, us-west1, light traffic. Artifact Registry is shared: about $0.10/GB beyond the free 0.5 GB.

| Item | staging | prod |
|---|---|---|
| Cloud SQL db-f1-micro, 10 GB SSD, backups | ~$10 | ~$10 |
| Cloud Run, scale to zero (free tier covers light use) | ~$0 | $0-5 |
| Load balancer forwarding rules (443 + 80) | none | ~$18 |
| Cloud CDN and load balancer data processing | none | <$1 |
| Secret Manager, 3 secrets | <$1 | <$1 |
| Uptime checks (1M executions/project free) | $0 | $0 |
| Alerting: 7 conditions × $0.35, billed from 2027-09-01 | $0 → ~$2.50 | $0 → ~$2.50 |
| Logging (50 GiB/project), log metrics, BigQuery (10 GB, 1 TB queries) free tiers | $0 | $0 |
| **Total** | **~$10** | **~$30** |
