# Deploying the console

The console is the pages of Agent Factory, served by Next.js. It is one of two parts:

- **The console** (this repository): serves the pages and forwards every `/api` request, and the agent card at `/.well-known/agent.json`, to the platform's service. It keeps no data and no session, decides nothing, and reads two settings.
- **The platform's service** (the backend): answers every `/api` request. It verifies Google Identity-Aware Proxy's signed assertion (`x-goog-iap-jwt-assertion`) on every request, gives each person their role from its own role map, and answers sign-in itself (`/api/auth/session`, `/api/auth/login`). Its deployment, and the second route machines use to reach it, are described in the service's own `deploy/README.md` and `.env.example`.

People reach the console through IAP. IAP signs each request, the console forwards it unchanged, and the service checks the signature. There is no console-only mode: without `BACKEND_ORIGIN` the console answers every request with a 503 that names the missing setting.

Files:

| File | What it is |
|---|---|
| `Dockerfile` (repository root) | The console image. |
| `.env.example` (repository root) | The two settings the console uses. |
| `deploy/console/cloudbuild.yaml` | Builds the image with Cloud Build. |
| `deploy/console/env.cloudrun.yaml` | The run-time setting for Cloud Run, for `--env-vars-file`. |
| `deploy/console/console.yaml` | The same deployment on GKE, behind IAP on an Ingress. |

## The settings

| Variable | When | Meaning |
|---|---|---|
| `NEXT_PUBLIC_ORIGIN` | build | The address people open the console at, in full, no trailing slash. Compiled into the pages (links, approval links, exported records). Required: the build stops without it. |
| `BACKEND_ORIGIN` | run | The service's address as the console's server reaches it: scheme, host and port. Required: without it every request is answered 503. |

The image sets `PORT=8080` (Cloud Run sets its own) and `HOSTNAME=0.0.0.0`. Next.js caches the images it optimises in `/app/.next/cache`. On a read-only root file system, mount a writable folder there (an `emptyDir` on GKE): without one the pages still load, and the log shows "Failed to write image to cache" for every image it optimises.

`NEXT_PUBLIC_ORIGIN` is the address exactly as people type it, scheme and port included. To try both images on one machine before Google Cloud, the service's `README.md` ("A local trial") runs them behind its IAP stand-in, which is for that trial only.

These are the service's settings, not the console's. Set them on the service:

| Variable | Why it matters to the console |
|---|---|
| `IAP_AUDIENCE` | The audience of the assertions IAP signs for **the console's** IAP resource. The service refuses every person until it is set and right. Cloud Run: `/projects/PROJECT_NUMBER/locations/REGION/services/CONSOLE_SERVICE`. GKE or Compute Engine: `/projects/PROJECT_NUMBER/global/backendServices/BACKEND_SERVICE_ID`. |
| `IAP_ROLE_MAP` | Who holds which role, by address or `@domain`. IAP names a person and never a role; someone the map does not name has no access. |
| `IAP_SIGNOUT_URL` | IAP's own sign-out address. Without it the console shows no sign-out button, because ending only the console's view would sign the person straight back in. |
| `IAP_JWKS_URL` | A mirror of Google's IAP keys, for a service whose network cannot reach `www.gstatic.com`. |
| `PUBLIC_API_URL` | The address machines reach the service at. The console prints every machine address (gateway, SDK, MCP, trigger and webhook addresses) from it, read from the session at run time; without it the console prints none and says so. |
| `WORKLOAD_URLS` | The address of each workload's own console, for the Workloads page's "Set up a run" button. |

## Cloud Run

Pick the values first:

```
PROJECT_ID=...
REGION=...                      # for example europe-west1
SERVICE=agentfactory-console
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
ORIGIN=https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app     # or your own domain
```

### 1. Build the image

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

The build downloads npm packages and the Inter and JetBrains Mono fonts, so it needs outbound access to `registry.npmjs.org`, `fonts.googleapis.com` and `fonts.gstatic.com`. The running console needs neither.

### 2. Deploy with IAP on the service

Put the service's address in `deploy/console/env.cloudrun.yaml`, then:

```
gcloud run deploy $SERVICE \
  --project $PROJECT_ID --region $REGION \
  --image $IMAGE \
  --port 8080 \
  --env-vars-file deploy/console/env.cloudrun.yaml \
  --no-allow-unauthenticated \
  --iap
```

The console must be able to reach `BACKEND_ORIGIN`. For a service on an internal address that means a route into its network (Direct VPC egress, or a Serverless VPC Access connector).

Let IAP call the console, and let people through IAP:

```
gcloud run services add-iam-policy-binding $SERVICE \
  --project $PROJECT_ID --region $REGION \
  --member serviceAccount:service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com \
  --role roles/run.invoker

gcloud iap web add-iam-policy-binding \
  --project $PROJECT_ID --region $REGION \
  --resource-type cloud-run --service $SERVICE \
  --member user:PERSON@EXAMPLE.COM \
  --role roles/iap.httpsResourceAccessor
```

Notes from Google's documentation:

- IAP goes on the Cloud Run service or on a load balancer in front of it, never both.
- In a project outside a Google organization, the first IAP enablement may have to be done in the Cloud console (or with a custom OAuth client), because an OAuth client cannot be created from the command line there.

### 3. Point the service at the console's IAP

On the service, set `IAP_AUDIENCE=/projects/$PROJECT_NUMBER/locations/$REGION/services/$SERVICE` and the roles in `IAP_ROLE_MAP`. The service knows two roles (its `identity/roles.py`):

| Role | May |
|---|---|
| `platform_admin` | Open every screen and take every action, including second-person approval. |
| `auditor` | Read every screen, the identity pages and the audit trail included. Changes nothing: every action is shown disabled. |

Anyone else IAP lets through holds no role and no permission; there is no default role.

## GKE

`deploy/console/console.yaml` runs the console as a Deployment behind an Ingress, with IAP on the console's backend service (a BackendConfig with `iap.enabled: true`, which uses a Google-managed OAuth client). Replace every value in capitals; `BACKEND_ORIGIN` is the service's address inside the cluster: with the service's own manifests (its `deploy/k8s/backend.yaml`) that is `http://agentfactory.agentfactory.svc.cluster.local`, its Service listening on port 80, not the container's 8080. The service's `IAP_AUDIENCE` is then the console's backend-service audience, `/projects/PROJECT_NUMBER/global/backendServices/BACKEND_SERVICE_ID`, which the IAP page of the Cloud console shows as the Signed Header JWT Audience once the Ingress exists.

## Check it

1. Open the console's address. Google asks you to sign in, then the console opens on Overview with your name at the foot of the sidebar.
2. If it does not, the page you land on says why:

| What you see | Likely cause |
|---|---|
| Google's own "You don't have access" page | The person lacks `roles/iap.httpsResourceAccessor` on the console. |
| A Cloud Run 403 "Forbidden" page | IAP's service agent lacks `roles/run.invoker` on the console, or IAP is not enabled on it. |
| Plain text: "This console has no service to talk to: BACKEND_ORIGIN is not set on this deployment." | `BACKEND_ORIGIN` is not set on the console. |
| "This console is reached through Google sign-in" | The request reached the service without IAP's header: IAP is not on the console. |
| "Your Google sign-in could not be verified" | The service's `IAP_AUDIENCE` does not match the console's IAP resource, or the service cannot reach Google's keys (see `IAP_JWKS_URL`). |
| "A role is required to access Agent Factory" | Google signed the person in, but the service's `IAP_ROLE_MAP` gives them no role that may open the console. |
| Every page shows its reads failing with status 500 ("Internal Server Error") | The console could not connect to `BACKEND_ORIGIN`. The console's log has the reason (for example `connect ECONNREFUSED` with the address it tried). |
| A button answers "cross-origin writes are refused" | The image was built with a `NEXT_PUBLIC_ORIGIN` that is not the address being used. Rebuild with the right one. |
