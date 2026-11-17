# Deploying the console on its own (Cloud Run)

This deploys the Agent Factory console as one Cloud Run service with nothing behind it: no backend, no worker, no database. It is for showing the console while the backend (which will run on GKE) is still being built.

What it does in this form:

- Serves every page of the console.
- Signs people in through Google Identity-Aware Proxy (IAP), enabled on the Cloud Run service itself, and gives each person a role from a mapping you set.
- Lists the models Vertex AI shows to the service's own service account, on the Configuration and Settings pages.
- Shows "Not connected on this deployment" wherever a page needs the backend.

What it does not do: run agents, store anything, or remember a setting across a restart.

Files:

| File | What it is |
|---|---|
| `Dockerfile` (repository root) | The console-only image. |
| `.env.example` (repository root) | Every setting the console reads, by name, with what each means. |
| `deploy/console/env.cloudrun.yaml` | The run-time settings for this deployment, for `--env-vars-file`. |
| `deploy/console/cloudbuild.yaml` | Builds the image with Cloud Build. |
| `deploy/console/console.yaml` | The same deployment on GKE, kept for reference. Not needed for Cloud Run. |

## What you need

- A project with Cloud Run, Artifact Registry, Secret Manager, IAP (`iap.googleapis.com`) and Vertex AI (`aiplatform.googleapis.com`) enabled.
- Roles to deploy to Cloud Run, to create a service account and a secret, and to administer IAP (`roles/run.admin`, `roles/iam.serviceAccountUser`, `roles/iap.admin`).
- If the project is not in a Google organization, IAP has to be enabled once from the Cloud console, or with a custom OAuth client. In an organization the command below is enough.

Pick three values first. Everything else follows from them.

```
PROJECT_ID=...
REGION=...                      # for example europe-west1
SERVICE=agentfactory-console
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
```

Two strings are fixed by those values, so the service can be deployed once, with nothing to paste back afterwards:

```
ORIGIN=https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app
IAP_AUDIENCE=/projects/$PROJECT_NUMBER/locations/$REGION/services/$SERVICE
```

`ORIGIN` is the address people will open. If the console will be reached at a custom domain instead, use that domain here. After the first deploy, confirm the address with `gcloud run services describe $SERVICE --region $REGION --format='value(urls)'`; if it is not in the list, rebuild with the one that is.

## 1. Build the image

`ORIGIN` is compiled into the pages, so it is a build argument and the build stops without it.

With Docker:

```
IMAGE=$REGION-docker.pkg.dev/$PROJECT_ID/REPOSITORY/agentfactory-console:TAG
docker build -t $IMAGE --build-arg NEXT_PUBLIC_ORIGIN=$ORIGIN .
docker push $IMAGE
```

Or with Cloud Build, from the repository root:

```
gcloud builds submit . --config deploy/console/cloudbuild.yaml \
  --substitutions _IMAGE=$IMAGE,_ORIGIN=$ORIGIN
```

The build downloads npm packages and the Inter and JetBrains Mono fonts, so it needs outbound access to `registry.npmjs.org`, `fonts.googleapis.com` and `fonts.gstatic.com`. The running service needs neither. The image is about 1.9 GB.

## 2. Service account and secret

The console lists Vertex AI's models as the service's own service account. No key file is used.

```
gcloud iam service-accounts create $SERVICE --project $PROJECT_ID
SA=$SERVICE@$PROJECT_ID.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member "serviceAccount:$SA" --role roles/aiplatform.user

openssl rand -hex 32 | gcloud secrets create $SERVICE-auth-secret \
  --project $PROJECT_ID --data-file=-
gcloud secrets add-iam-policy-binding $SERVICE-auth-secret --project $PROJECT_ID \
  --member "serviceAccount:$SA" --role roles/secretmanager.secretAccessor
```

`roles/aiplatform.user` (Vertex AI User) is the role this was written against. The narrowest permission that allows listing Model Garden's models was not confirmed; if policy calls for a custom role, start from that one and read the service log (section 5).

### Optional: let the console list who has access

The Identity pages can show who Google lets through to the console, read from IAP's own access list. For that the same service account needs to read the IAP policy. A custom role with three read permissions is enough; it cannot change who has access:

```
gcloud iam roles create agentfactoryIapPolicyReader --project $PROJECT_ID \
  --title "IAP policy reader" \
  --permissions iap.web.getIamPolicy,iap.webTypes.getIamPolicy,iap.webServices.getIamPolicy

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member "serviceAccount:$SA" \
  --role projects/$PROJECT_ID/roles/agentfactoryIapPolicyReader
```

Without it the console still works; the "Who can open this console" card is simply not shown. A group or a domain on the list appears as one entry; the console does not list a group's members.

## 3. Deploy

Edit `deploy/console/env.cloudrun.yaml`: put the `IAP_AUDIENCE` string from above in it, and the people and roles in `IAP_ROLE_MAP` (section 4). Then:

```
gcloud run deploy $SERVICE \
  --project $PROJECT_ID --region $REGION \
  --image $IMAGE \
  --service-account $SA \
  --port 8080 --memory 1Gi --cpu 1 --min-instances 1 --max-instances 2 \
  --env-vars-file deploy/console/env.cloudrun.yaml \
  --set-secrets AUTH_SECRET=$SERVICE-auth-secret:latest \
  --no-allow-unauthenticated \
  --iap
```

Then let IAP call the service, and let people through IAP:

```
gcloud run services add-iam-policy-binding $SERVICE \
  --project $PROJECT_ID --region $REGION \
  --member serviceAccount:service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com \
  --role roles/run.invoker

gcloud iap web add-iam-policy-binding \
  --project $PROJECT_ID --region $REGION \
  --resource-type cloud-run --service $SERVICE \
  --member group:GROUP@EXAMPLE.COM \
  --role roles/iap.httpsResourceAccessor
```

`gcloud run services describe $SERVICE --region $REGION` should show `Iap Enabled: true`.

Notes:

- IAP goes on the Cloud Run service, not on a load balancer in front of it. Google does not allow both at once.
- `--min-instances 1` keeps one instance warm, so the first page of a showing does not wait for a cold start. Drop it afterwards if cost matters.
- Sessions do not depend on which instance answers: the session cookie is signed with `AUTH_SECRET`, and the person is read from IAP's header on every request.
- The console checks IAP's signature against Google's keys at `https://www.gstatic.com/iap/verify/public_key-jwk`. If the service's outbound traffic is routed through a network that blocks that address, mirror the file and set `IAP_JWKS_URL`.

## 4. Roles

IAP says who a person is and nothing about what they may do, so the role comes from `IAP_ROLE_MAP`, a JSON object:

```
{"asha.rao@example.com": "platform_admin", "internal.audit@example.com": "auditor"}
```

A key is an email address or `@domain`. An address wins over its domain.

The roles follow the GUI access matrix for this console:

| Role | May |
|---|---|
| `platform_admin` | Open every screen and take every action: change settings, start and stop runs, deploy, and give second-person approval. |
| `auditor` | Read every screen, including the identity pages and the audit trail. Changes nothing: every action is shown disabled. |
| `use_case_reviewer`, `analyst` | Nothing here. They work in the workloads' own consoles. Naming them in the map is allowed and gives no access. |

**Someone the map does not name has no access.** Google signs them in, and the console shows "A role is required". Give `@domain` a role only if every person in that domain should hold it.

A change to the map takes effect when a new revision is deployed.

There is no sign-out button unless `IAP_SIGNOUT_URL` is set, because signing out of the console alone would sign the person straight back in. `https://HOST/?gcp-iap-mode=CLEAR_LOGIN_COOKIE` is IAP's own sign-out address; whether it behaves the same for IAP on Cloud Run was not tried.

## 5. Check it

1. Open the address. Google asks you to sign in, then the console opens on Overview with your name at the foot of the sidebar.
2. Open Configuration, then the Models panel. It should show "Google Vertex AI, Connected" with the project, the region and the list of models. Settings shows the same block.
3. Open a few other pages. Each should show its layout and a "Not connected on this deployment" note, never an error.

If something is off:

| What you see | Likely cause |
|---|---|
| Google's own "You don't have access" page | The person lacks `roles/iap.httpsResourceAccessor` on the service. |
| A Cloud Run 403 "Forbidden" page | IAP's service agent lacks `roles/run.invoker` on the service, or IAP is not enabled on it. |
| "A role is required to access Agent Factory" | Google signed the person in, but `IAP_ROLE_MAP` gives them no role that can open the console (section 4). |
| "This console is reached through Google sign-in" | The request reached the console without IAP's header: IAP is not enabled on the service. |
| "Your Google sign-in could not be verified" | `IAP_AUDIENCE` does not match the service (project number, region and service name must be exact), or the service cannot reach Google's keys (see `IAP_JWKS_URL`). |
| The console opens with "Local operator, Sign-in is off" | `IAP_AUDIENCE` or `AUTH_SECRET` is not set on the service, so sign-in is off. |
| No "Who can open this console" card on Identity | The service account cannot read the IAP policy (see the optional step in section 2). The log has a line starting `[iap-access]`. |
| No Vertex AI block on Configuration | The service could not list models. Its log has a line starting `[vertex]` with the reason: no identity, or the status Vertex AI answered for each list. |
| The model list is for the wrong region | The console uses the region the service runs in. Set `REGION` to the region Vertex AI is used in. |
| A page shows a red error | The image was probably built with `NEXT_PUBLIC_CONSOLE_QUIET=0`. |
| A button answers "cross-origin writes are refused" | The image was built with an `ORIGIN` that is not the address being used. Rebuild with the right one. |

## Settings

`.env.example` at the repository root lists every setting the console reads, grouped by when it matters. For this deployment:

| Variable | When | Meaning |
|---|---|---|
| `NEXT_PUBLIC_ORIGIN` | build | The public address. Required. |
| `NEXT_PUBLIC_CONSOLE_QUIET` | build | `1` (default): failures read as "not connected". `0` once a backend is behind the console. |
| `AUTH_SECRET` | run | Signs the session cookie. Required. From Secret Manager. |
| `IAP_AUDIENCE` | run | Switches IAP sign-in on. Required. |
| `IAP_ROLE_MAP` | run | Roles by address or domain. |
| `WORKLOAD_URLS` | run | Optional. JSON giving the address of each workload's own console (`sast`, `pentest`, `firewall`, `threat_hunt`). The "Set up a run" button on Workloads opens it in a new tab; a workload left out is shown as not live yet. |
| `IAP_SIGNOUT_URL` | run | Optional. Shows a sign-out button. |
| `IAP_JWKS_URL` | run | Optional. A mirror of Google's IAP keys. |
| `GCP_PROJECT`, `REGION` | run | Optional. Override what the metadata server says. |
| `VERTEX_PUBLISHERS` | run | Optional. Publishers to list, comma separated. Default `google,anthropic,meta,mistralai`. |
| `VERTEX_ENDPOINT` | run | Optional. The Vertex AI API address, for a private endpoint. |

The image sets `AGENTFACTORY_DB=off` and `AGENTFACTORY_RUNTIME_ROOT=/data/runtime` itself. Cloud Run sets `PORT`. Leave all three.

## Later: connecting the backend on GKE

Not part of this deployment; listed so the names are known. When the backend is up on GKE:

- `BACKEND_ORIGIN` is its address as this service reaches it. The service then needs a route into the cluster's network (Direct VPC egress or a connector) and the backend an internal address.
- `RUNTIME_KEY` is the shared secret the console adds to what it forwards.
- `AGENTFACTORY_DB` is set to anything but `off`, with `AGENTFACTORY_DB_DSN` (or the separate parts) naming the registry database, and `KNOWLEDGE_DB_DSN` the knowledge store.
- The image is rebuilt with `NEXT_PUBLIC_CONSOLE_QUIET=0`, so real failures show again.

## What has and has not been proven

- The image was built and run locally, and every page was opened in it. It was also run the way Cloud Run runs it: on a port given in `PORT`, with a stand-in for the metadata server supplying the service account, project and region.
- Sign-in was exercised end to end against a stand-in for IAP that signs assertions the way Google documents them, including the Cloud Run audience format. It has not run behind a real IAP.
- The list of who has access was exercised against a stand-in for IAP's policy call. It has not read a real IAP policy.
- The model list was exercised against a stand-in for Vertex AI's list calls, written from Google's published API description. It has not listed models from a real project, on Cloud Run or anywhere else.
- The commands on this page were written from Google's documentation. They have not been run against a project.
