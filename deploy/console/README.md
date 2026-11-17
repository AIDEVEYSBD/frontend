# Deploying the console on its own

This deploys the Agent Factory console as one container with nothing behind it: no backend, no worker, no database. It is meant for showing the console while the control plane is still being built.

What it does in this form:

- Serves every page of the console.
- Signs people in through Google Identity-Aware Proxy (IAP) and gives each person a role from a mapping you set.
- Lists the models Vertex AI shows to the pod's service account, on the Configuration and Settings pages.
- Shows "Not connected on this deployment" wherever a page needs the control plane.

What it does not do: run agents, store anything, or remember a setting across a restart.

## What you need

- A GKE cluster with Workload Identity, in the project where Vertex AI is enabled.
- A DNS name for the console and a reserved global static IP address it resolves to.
- Permission to enable IAP on the load balancer and to grant IAP access.
- A registry the cluster can pull from.

## 1. Build the image

From the root of this repository:

```
docker build -t REGISTRY/agentfactory-console:TAG \
  --build-arg NEXT_PUBLIC_ORIGIN=https://HOST .
docker push REGISTRY/agentfactory-console:TAG
```

`NEXT_PUBLIC_ORIGIN` is the address people will open, in full, with no trailing slash. It is compiled into the pages, so it is set at build time and the build stops without it. If the address changes, rebuild.

The build downloads npm packages and the Inter and JetBrains Mono fonts from Google Fonts, so the build machine needs outbound access to `registry.npmjs.org` and `fonts.googleapis.com` / `fonts.gstatic.com`. The running container does not need either.

## 2. Give the pod a Google identity for Vertex AI

The console lists models with the pod's own service account. Nothing is stored and no key file is used.

```
gcloud iam service-accounts create agentfactory-console --project PROJECT_ID

gcloud projects add-iam-policy-binding PROJECT_ID \
  --member "serviceAccount:agentfactory-console@PROJECT_ID.iam.gserviceaccount.com" \
  --role roles/aiplatform.user

gcloud iam service-accounts add-iam-policy-binding \
  agentfactory-console@PROJECT_ID.iam.gserviceaccount.com \
  --role roles/iam.workloadIdentityUser \
  --member "serviceAccount:PROJECT_ID.svc.id.goog[NAMESPACE/agentfactory-console]"
```

`roles/aiplatform.user` (Vertex AI User) is the role this was written against. The narrowest permission that allows listing Model Garden's models was not confirmed; if your policy calls for a custom role, start from that one and check the pod log (section 6).

The console works out the project and region from the metadata server. Set `GCP_PROJECT` or `REGION` on the container only to override them.

## 3. Deploy

Edit `deploy/console/console.yaml` and replace every value in capitals:

| Value | What it is |
|---|---|
| `NAMESPACE` | The namespace to deploy into. |
| `IMAGE` | The image you pushed. |
| `PROJECT_ID`, `CONSOLE_GSA` | The project and the service account from step 2 (`agentfactory-console`). |
| `HOST` | The DNS name, the same one used in `NEXT_PUBLIC_ORIGIN`. |
| `STATIC_IP_NAME` | The name of the reserved global static IP address. |
| `AUTH_SECRET` | A long random value: `openssl rand -hex 32`. It signs the console's session cookie. |
| `IAP_ROLE_MAP` | Who holds which role (step 5). |
| `IAP_AUDIENCE` | Leave the placeholder for now; step 4 fills it in. |

```
kubectl apply -f deploy/console/console.yaml
```

The certificate and the load balancer take ten to twenty minutes the first time.

## 4. Switch on IAP and tell the console its audience

The manifest already asks for IAP on the load balancer (`BackendConfig`, `iap.enabled: true`), using Google's managed OAuth client. Three things remain.

**Grant access.** In the Google Cloud console, open Security, Identity-Aware Proxy, select the backend service for `agentfactory-console`, choose Add principal, and give the people or groups who may open the console the role **IAP-secured Web App User**. Without it, IAP turns them away before the console sees the request.

**Read the audience.** On the same page, open the menu beside the backend service and choose **Signed Header JWT Audience**. It reads:

```
/projects/PROJECT_NUMBER/global/backendServices/BACKEND_SERVICE_ID
```

The same value from the command line: the project number from `gcloud projects describe PROJECT_ID`, and the id from `gcloud compute backend-services list` then `gcloud compute backend-services describe NAME --global --format='value(id)'`.

**Set it.** Put that string in `IAP_AUDIENCE` in the manifest and apply again. The console only accepts an IAP assertion issued for this exact audience, so a wrong value shows everyone "Your Google sign-in could not be verified".

The console checks IAP's signature against Google's published keys at `https://www.gstatic.com/iap/verify/public_key-jwk`. If the cluster cannot reach that address, mirror the file somewhere it can reach and set `IAP_JWKS_URL` to the mirror.

## 5. Roles

IAP says who a person is and nothing about what they may do, so the role comes from `IAP_ROLE_MAP`, a JSON object:

```
{"asha.rao@example.com": "administrator", "@example.com": "viewer"}
```

A key is an email address or `@domain`. An address wins over its domain. Someone the map does not name is a viewer, who can read and change nothing. The roles are:

| Role | May |
|---|---|
| `viewer` | Read every page. |
| `operator` | Read, start runs, answer approvals. |
| `administrator` | Everything, including configuration and the Identity pages. |

A change to the map takes effect on a person's next request after the pod restarts.

There is no sign-out button, because signing out of the console alone would sign the person straight back in. To offer one, set `IAP_SIGNOUT_URL` to `https://HOST/?gcp-iap-mode=CLEAR_LOGIN_COOKIE`.

## 6. Check it

1. Open `https://HOST`. Google asks you to sign in, then the console opens on Overview with your name at the foot of the sidebar.
2. Open Configuration, then the Models panel. It should show "Google Vertex AI, Connected" with the project, the region and the list of models. Settings shows the same block.
3. Open a few other pages. Each should show its layout and a "Not connected on this deployment" note, never an error.

If something is off:

| What you see | Likely cause |
|---|---|
| Google's own "You don't have access" page | The person lacks **IAP-secured Web App User** on the backend service. |
| "This console is reached through Google sign-in" | The request did not come through IAP: IAP is not enabled on the backend service, or the pod was reached directly. |
| "Your Google sign-in could not be verified" | `IAP_AUDIENCE` does not match, or the pod cannot reach Google's keys (see `IAP_JWKS_URL`). |
| The console opens with "Local operator, Sign-in is off" | `IAP_AUDIENCE` or `AUTH_SECRET` is not set on the container, so sign-in is off. Do not leave it this way on a reachable address. |
| No Vertex AI block on Configuration | The pod could not list models. `kubectl logs` shows a line starting `[vertex]` with the reason: no identity (Workload Identity is not bound), or the status Vertex AI answered for each list. |
| A page shows a red error | Tell the team; the image was probably built with `NEXT_PUBLIC_CONSOLE_QUIET=0`. |

## Settings in one place

| Variable | When | Meaning |
|---|---|---|
| `NEXT_PUBLIC_ORIGIN` | build | The public address. Required. |
| `NEXT_PUBLIC_CONSOLE_QUIET` | build | `1` (default): failures read as "not connected". `0` once a control plane is behind the console. |
| `AUTH_SECRET` | run | Signs the session cookie. Required for sign-in. |
| `IAP_AUDIENCE` | run | Switches IAP sign-in on. Required for sign-in. |
| `IAP_ROLE_MAP` | run | Roles by address or domain. |
| `IAP_SIGNOUT_URL` | run | Optional. Shows a sign-out button. |
| `IAP_JWKS_URL` | run | Optional. A mirror of Google's IAP keys. |
| `GCP_PROJECT`, `REGION` | run | Optional. Override what the metadata server says. |
| `VERTEX_PUBLISHERS` | run | Optional. Publishers to list, comma separated. Default `google,anthropic,meta,mistralai`. |
| `VERTEX_ENDPOINT` | run | Optional. The Vertex AI API address, for a private endpoint. |

The image sets `AGENTFACTORY_DB=off` and `AGENTFACTORY_RUNTIME_ROOT=/data/runtime` itself; leave them.

## Cloud Run instead of GKE

The same image runs on Cloud Run with IAP enabled on the service. The audience is then `/projects/PROJECT_NUMBER/locations/REGION/services/SERVICE_NAME`, the service's own service account takes the place of Workload Identity, and the rest of this page applies unchanged. This path was not tried.

## What has and has not been proven

- The image was built and run locally. Sign-in was exercised end to end against a stand-in for IAP that signs assertions the way IAP documents them. It has not run behind a real IAP.
- The model list was exercised against a stand-in for Vertex AI's list calls, written from Google's published API description. It has not listed models from a real project.
- The manifest was written from Google's documentation and from the manifest this project already runs on GKE; this exact file has not been applied to a cluster.
