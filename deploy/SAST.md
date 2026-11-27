# Joining SAROS SAST to Saros: the integration guide

For an engineer who has **Saros** (formerly Agent Factory) running in a Google Cloud project, and **SAROS SAST** to run
beside it as an attached agent:
- every scan is a Saros run;
- every model call goes through the Saros gateway, which screens, prices and caps it;
- every finding is filed in Saros.

This is what was done on the first test deployment on 26 November 2026 (a GKE cluster in europe-west1), written so it
can be repeated elsewhere.

- **Placeholders** are in CAPITALS.
- **No secret appears here:** every key and password lives in a Kubernetes Secret, and goes there from your own shell.
- **Two halves, in this order:**
  - Part 1 is the **Saros side**, done by whoever runs Saros.
  - Part 2 is the **SAST side**, done by whoever runs SAROS SAST.
- **Work in parallel:** the SAST team can build its images while Part 1 is under way. It cannot install until steps S3–S9 are done.

**Before you start.** Saros must already be deployed and passing `preflight`, as its deployment guide (`deploy/GCP.md`
in either Saros repository) describes: the backend on GKE, the console behind IAP, AlloyDB, Vertex AI and Model Armor.
Part 1 assumes the backend runs in namespace `agentfactory` with its Service `agentfactory` on port 80 (pods on 8080).

---

# Part 1. The Saros side

## S1. The Saros version

| Part | Version | Why |
|---|---|---|
| Backend (`abb`) | `35e808f` or later | Includes:<ul><li>tool calling and streaming through the gateway;</li><li>`reasoning_effort`;</li><li>each tool result screened once;</li><li>empty text no longer sent to Model Armor;</li><li>workloads run by attached agents;</li><li>guardian rules that name attached agents.</li></ul> |
| Console (`abb-platform`) | `6faec8a` or later | Workloads for attached agents; an attached agent's page links to its runs and access |
| Backend, for Claude and other Model Garden partner models | `10ff27b` or later | the Model Garden connector (S11) |

Build and roll out as `deploy/GCP.md` section 14 says. If the release adds migrations, run the migrate Job before
the backend Deployment.

## S2. Offer the models

Console → Configuration → **Models**. For each model the SAST agent may use:
1. Tick it.
2. Put it in a tier.
3. Enter its prices, per million tokens, from Google's Vertex AI pricing page.
4. Under **Clearance and fallbacks**, clear it for **public, internal and confidential**. Scanned code is confidential, and the agent's
   data class is confidential.

The test deployment's prices were Google list prices on the `global` endpoint:

| Model | In | Out |
|---|---|---|
| `google/gemini-4-argon` (the agent's default) | $4.00 | $20.00 |
| `google/gemini-4-carbon` | $4.00 | $20.00 |
| `google/gemini-4-neon` | $3.00 | $15.00 |
| `google/gemini-3.1-pro-preview` | $2.00 | $12.00 |
| `google/gemini-2.5-pro` | $1.25 | $10.00 |

A model with no price is refused for an agent with a spend cap (402 `model_unpriced`).

**Gemini 3 and later return a "thought signature"** on each tool call. The gateway passes it through, and the client
must send it back unchanged; SAROS SAST does. LangChain drops it, so with LangChain use Gemini 2.5.

## S3. Register the SAST use case

Console → **Workloads** → **Use cases** → register:

| Field | Value |
|---|---|
| Name | Static application security testing (SAST) |
| Workload | `sast` |
| Owner | the SAST owner's email |
| Data classes | public, internal, confidential |
| Autonomy | L2 |

Then **send it for approval**, and a **second platform admin approves** it. The person who registered it cannot
approve it.

## S4. Attach the agent and hand over its key

Console → Configuration → **Connections** → **Third-party agents** → **Attach**:

| Field | Value |
|---|---|
| Id | `sast` (this must equal the workload id, or map it with `WORKLOAD_AGENTS`) |
| Name | SAST |
| Mode / language | SDK / python |
| Owner | the SAST owner's email |
| Grants | `finding.record` |
| Gate | at destructive (so filing a finding is not held for a person) |
| Data class | confidential |
| Model for "auto" | `google/gemini-4-argon` |
| Models it may name | the models from S2 |
| Daily cap | e.g. $100 |

The answer shows the agent's key (`afatt_…`) **once**. Put it straight into the cluster from your own shell, and never into a chat or a ticket:

```bash
kubectl --context CTX create namespace sast
kubectl --context CTX -n sast create secret generic agentfactory-agent --from-file=AGENTFACTORY_KEY=/dev/stdin
# paste the key, press Enter, then Ctrl-D
```

A **second platform admin approves** the attachment, on the same panel. Until then the key answers 403
`attachment_not_approved`.

After approval, any change to the agent's models, data class or caps is a **reviewed policy change**: proposed by
one admin and approved by another, who is neither the proposer nor the person who attached the agent. Make these
changes on the **Policy** page.

## S5. The per-scan cap

Console → Security and Policy → **Policy** → propose a change to the **guardian**:

| Field | Value |
|---|---|
| `cost_per_run_usd` | 40 (the test ran at $20) |
| `on_cost` | stop |
| `agents` | `sast` |

A second admin approves it.

The guardian checks runs in flight about every 10 seconds, so a scan may pass the cap by a few calls before it is
stopped. A first test scan of a small repository cost $0.28.

## S6. Point the Workloads page at SAST

Add to the backend's settings file, then re-create the Secret and restart (`deploy/GCP.md` section 4.5):

```
WORKLOAD_URLS={"sast":"https://SAST_HOST"}
```

The Workloads page then lists SAST, with its status, and its **Set up a run** button opens the SAST screens.

## S7. Access for the SAST engineer

Grant the SAST engineer no more than they need:

```bash
U=SAST_ENGINEER_EMAIL
# Connect to this cluster only: no rights inside it beyond what RBAC gives below.
gcloud projects add-iam-policy-binding PROJECT_ID --member=user:$U --role=roles/container.clusterViewer \
  --condition="expression=resource.name == 'projects/PROJECT_ID/locations/REGION/clusters/CLUSTER',title=this-cluster-only"  # pragma: allowlist secret
# Push images to one repository.
gcloud artifacts repositories add-iam-policy-binding REPOSITORY --location=REGION --member=user:$U --role=roles/artifactregistry.writer
# Full rights in namespace sast only.
kubectl --context CTX -n sast create rolebinding sast-developer --clusterrole=admin --user=$U
```

Then give the console roles in the backend's `IAP_ROLE_MAP`: `auditor` to watch, or `platform_admin` to approve.

**The SDK.** SAST vendors Saros's Python SDK (`sdk/python` in the backend repository). The engineer needs no access to
that repository. Hand it over as a package in a generic Artifact Registry repository, readable by them:

```bash
gcloud artifacts repositories create SDK_REPO --repository-format=generic --location=REGION
mkdir -p /tmp/saros-sdk && git -C BACKEND_REPO archive HEAD sdk | tar -x -C /tmp/saros-sdk && tar -czf saros-sdk-VERSION.tar.gz -C /tmp saros-sdk
gcloud artifacts generic upload --location=REGION --repository=SDK_REPO --package=saros-sdk --version=VERSION --source=saros-sdk-VERSION.tar.gz
gcloud artifacts repositories add-iam-policy-binding SDK_REPO --location=REGION --member=user:$U --role=roles/artifactregistry.reader
```

## S8. The SAST database on AlloyDB

SAST keeps its own database on Saros's AlloyDB instance, under two users:
- **`sast`** owns the tables and runs SAST's one-time set-up;
- **`sast_app`** is what the services run as.

Run these as the instance admin (`postgres`), from a throwaway `psql` pod in the VPC (`deploy/GCP.md` section 3.2).
`\password` asks twice and sends only a hash, so no password lands in a log:

```sql
CREATE DATABASE sast;
CREATE USER sast;            \password sast
GRANT ALL PRIVILEGES ON DATABASE sast TO sast;
CREATE USER sast_app;        \password sast_app
GRANT CONNECT ON DATABASE sast TO sast_app;
REVOKE CONNECT ON DATABASE sast FROM PUBLIC;
REVOKE CONNECT ON DATABASE agentfactory FROM PUBLIC;   -- SAST's users can never open Saros's database
\c sast
GRANT CREATE ON SCHEMA public TO sast;
GRANT USAGE ON SCHEMA public TO sast_app;
-- What SAST's set-up needs (it makes SECURITY DEFINER functions owned by a role with no login):
CREATE ROLE saros_staff_definer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT saros_staff_definer TO sast;
GRANT USAGE, CREATE ON SCHEMA public TO sast WITH GRANT OPTION;
REVOKE TEMPORARY ON DATABASE sast FROM PUBLIC;
```

`sast_app` gets **no table rights from you**: SAST's set-up grants each service exactly what it needs, with row-level
security on.

Two Secrets go in namespace `sast`, with the passwords typed from your shell:
- `sast-db` for the owner, used by the set-up only;
- `sast-db-app` for the services.

Each holds `PGHOST=ALLOYDB_IP`, `PGPORT=5432`, `PGDATABASE=sast`, `PGUSER`, `PGSSLMODE=require`, `PGPASSWORD`, and a
`DATABASE_URL` without the password.

AlloyDB needs **no Auth Proxy and no client certificate** here: the connection is direct on the private IP, with
`sslmode=require`.

## S9. The SAST screens' sign-in address (IAP)

People reach the SAST screens through Google IAP, like the Saros console. The Saros team owns the load balancer side.

1. **An address.** Reserve a global static IP. Point a DNS name at it (SAST_HOST); the test used `sast.IP-WITH-DASHES.sslip.io`, which needs no DNS work.

   ```bash
   gcloud compute addresses create SAST_IP_NAME --global
   ```

2. **The objects in namespace `sast`.** SAST's web pods must carry the label `app: sast-web`, a container port named `http`, and a `readinessProbe` on a path that answers 200 without sign-in.

   **Set the health check explicitly.** Otherwise the load balancer checks `/`, marks the pod unhealthy, and people get Google's "Server Error".

   ```yaml
   apiVersion: v1
   kind: Service
   metadata:
     name: sast-web
     namespace: sast
     annotations:
       cloud.google.com/neg: '{"ingress": true}'
       cloud.google.com/backend-config: '{"default": "sast-web"}'
   spec:
     selector: {app: sast-web}
     ports: [{name: http, port: 80, targetPort: http}]
   ---
   apiVersion: cloud.google.com/v1
   kind: BackendConfig
   metadata: {name: sast-web, namespace: sast}
   spec:
     iap: {enabled: true}
     healthCheck: {type: HTTP, requestPath: /healthz, port: WEB_CONTAINER_PORT}   # the test used 3000
   ---
   apiVersion: networking.gke.io/v1
   kind: ManagedCertificate
   metadata: {name: sast-web, namespace: sast}
   spec: {domains: [SAST_HOST]}
   ---
   apiVersion: networking.k8s.io/v1
   kind: Ingress
   metadata:
     name: sast-web
     namespace: sast
     annotations:
       kubernetes.io/ingress.class: gce
       kubernetes.io/ingress.global-static-ip-name: SAST_IP_NAME
       networking.gke.io/managed-certificates: sast-web
   spec:
     defaultBackend: {service: {name: sast-web, port: {number: 80}}}
   ```

3. **The IAP audience,** once the Ingress has made its backend service (a few minutes):

   ```bash
   BS=$(kubectl --context CTX -n sast get ingress sast-web -o jsonpath='{.metadata.annotations.ingress\.kubernetes\.io/backends}' | python3 -c 'import json,sys; print(next(iter(json.load(sys.stdin))))')
   echo "/projects/PROJECT_NUMBER/global/backendServices/$(gcloud compute backend-services describe $BS --global --format='value(id)')"
   ```

   Send that value to the SAST team (`SAROS_IAP_AUDIENCE`).

4. **Who may sign in.** On that backend service only:

   ```bash
   gcloud iap web add-iam-policy-binding --resource-type=backend-services --service=$BS --member=user:PERSON_EMAIL --role=roles/iap.httpsResourceAccessor
   ```

   Give the SAST team the same emails without posting them anywhere public, for example in a ConfigMap:

   ```bash
   kubectl --context CTX -n sast create configmap sast-admins --from-literal=ADMIN_EMAILS="EMAIL1,EMAIL2"
   ```

5. **The certificate** turns Active 15–60 minutes after the name resolves to the IP.

## S10. Network

- **From namespace `sast` to Saros.** Saros's namespace has no NetworkPolicy, so `sast` may reach it. If SAST's own egress policy names ports, it must allow TCP **8080**, because NetworkPolicy sees the pod port, not the Service's 80, plus DNS to kube-dns. On Dataplane V2 clusters SAST allows DNS to any address.
- **Outbound.** Cloud NAT on the cluster's network carries GitHub, package installs and `www.gstatic.com` (IAP's keys).
- **Model Armor without NAT.** Private Google Access does not cover `modelarmor.REGION.rep.googleapis.com`. Without NAT, give it a Private Service Connect endpoint and a private DNS zone (`deploy/GCP.md` section 2.4).
- **Your own test pods** cannot reach Saros from `sast` once SAST's policy is on: only SAST's pods are allowed out. Check from Saros's side instead (S12).

## S11. Claude and other Model Garden models

Saros `10ff27b` and later can call Model Garden's partner models:

| Models | Id form | How Saros calls them |
|---|---|---|
| Claude | `anthropic/claude-opus-5-5`, `anthropic/claude-sonnet-5-5` | Anthropic's API through `rawPredict`, translated |
| Llama, gpt-oss, DeepSeek and others | `meta/…-maas` and similar | the OpenAI-compatible endpoint |
| Mistral | `mistralai/…` | only in `us-central1` and `europe-west4` |

To use Claude:
1. **Enable it.** In the Cloud console, Model Garden → Claude Opus 5.5 (and Sonnet 5.5) → **Enable**. This accepts Anthropic's terms and is billed through the project. It needs someone authorised to accept those terms, which is often not the platform admin. Until it is enabled, every call answers 404.
2. **List the publisher.** Add `anthropic` to the backend's `VERTEX_PUBLISHERS`, for example `google,anthropic`, then re-create the Secret and restart. Without it, Configuration → Models will not offer Claude.
3. **Offer and allow it.** Offer it with its price and clearance (S2), then propose it for the agent (S4, a reviewed change).
4. **Raise the per-scan cap.** Claude Opus costs more per token; $40 a scan was the planned figure.

**Not proven yet:** Claude was only tested against a stand-in. Saros's own features that use the deployment's default
model (the chatbot, knowledge answers, the evaluation judge) may hit Claude's limits:
- structured-output schemas;
- `temperature` refused;
- thinking counted against small token caps.

Keep a Gemini model as the deployment default until that is checked. SAST's calls through the gateway are not
affected.

## S12. Checks from the Saros side, in order

1. **`preflight` in the backend pod:** every required check passes.
   ```bash
   kubectl --context CTX -n agentfactory exec deploy/agentfactory -- python -m agentfactory preflight
   ```
2. **The Workloads page.** SAST reads **available**. If it reads awaiting approval, detached or no use case, S3–S4 are not done.
3. **The first scan.** Watch it on Runs, filtered to the agent `sast`. Its steps, model calls and tool calls appear as it goes; findings appear under Workloads → SAST and on Findings; its cost appears on Costs.
4. **Refusals.** A refused call shows on the run with its control. The usual ones:

   | Control | Meaning | Fix |
   |---|---|---|
   | `modelarmor.response.sdp` | the model quoted a secret in its output | SAST masks secrets in findings |
   | `screener.unavailable` | Model Armor could not be reached | check the PSC endpoint or NAT |
   | `cost_per_day` (402) | the daily cap was reached | raise it through a reviewed change |
   | `run_not_open` (409) | the guardian stopped the run | the per-scan cap was reached |

## S13. What the first deployment met on the Saros side

| Seen | Cause | Fix |
|---|---|---|
| The GKE cluster ends in ERROR | the organization requires Shielded VMs with Secure Boot | `--shielded-secure-boot --shielded-integrity-monitoring` on the cluster and every node pool |
| `kubectl` hangs | private nodes turn on authorized networks with none listed | `gcloud container clusters update CLUSTER --enable-dns-access`, then `get-credentials --dns-endpoint` |
| No Cloud Router could be made | the project's router quota was used up | ask Google for more (it was approved within minutes) |
| Every model call refused "screener unavailable" before NAT existed | Model Armor's regional endpoint is not on Private Google Access | a Private Service Connect endpoint for Model Armor (S10) |
| Google "Server Error" on the SAST address | the load balancer checked `/` | the BackendConfig health check (S9) |
| 6 calls of the first scan refused as "screener unavailable" | Saros sent an empty file to Model Armor | fixed in `35e808f` |
| A finding lost to `modelarmor.response.sdp` | the model quoted a hard-coded password | SAST masks secret values (its half) |
| The Overview's agent link said "could not be read" | the link assumed a saved agent | fixed in console `6faec8a` |

---

# Part 2. The SAST side

*Written by the SAST team; corrected by the Saros team where the Saros side differs.*

For an engineer who has **Saros (Agent Factory) running** in a Google Cloud project and **SAROS SAST
deployed on its own**, and wants SAST to run as an attached agent of Saros: every scan a Saros run,
every model call through the Saros gateway (Model Armor, pricing, caps), every finding filed in
Saros. This is what was done on the first test deployment (a GKE cluster beside Saros,
europe-west1) on 26 November 2026, written so it can be repeated elsewhere. Placeholders are in
CAPITALS. No secret appears here: every key and password lives in a Kubernetes Secret.

Two halves, in this order:

1. **Saros side** (done by whoever runs Saros): attach the agent, its models and caps, the
   database, the sign-in address. Section A.
2. **SAST side** (done by whoever runs SAROS SAST): build, configure, install, check. Section B.

The Saros team's own steps are in their half of this guide; section A lists what SAST needs from
them so nothing is missed.

### What you end up with

- SAROS SAST (screens, API, scan worker, relay, reaper) in a namespace `sast` on the **same GKE
  cluster as Saros**, behind a Google sign-in (IAP) address of its own.
- Its own database on Saros's AlloyDB instance, as two users: an owner for the one-time set-up and
  a limited application user for the services (no DROP, no temporary tables, row-level security on).
- Scans started from the SAST screens. Each one opens a Saros run, records a step at each stage,
  checks every minute whether someone stopped it, and files each finding with `finding.record`.
- Every model call goes to the Saros gateway; nothing calls Vertex AI directly. Runtime proof (DAST)
  is off. Private repositories are not supported in this mode yet (see Limits).

### Versions

- **SAROS SAST**: the `saros/agent` branch (commit `f1ab8cd` or later), or `main` once merged.
  It vendors the Saros SDK unchanged in `vendor/saros-sdk` (version `0.1.0-8e68485`).
- **Saros**: backend branch `abb` at `35e808f` or later, console branch `abb-platform` at `6faec8a` or later
  (they carry the empty-text fix for Model Armor, `reasoning_effort` on the gateway, tool results screened once,
  and the attached-agent page). For Claude: backend `10ff27b` or later (the Model Garden connector).

### A. What SAST needs from the Saros side

| # | What | Why |
|---|---|---|
| A1 | The **use case** "Static application security testing (SAST)" proposed and approved (two people) | findings are filed under the SAST workload |
| A2 | The **agent attached**: id `sast`, granted `finding.record`, data up to confidential, its models, a daily cap; approved by a second admin | without it the key answers 403 `attachment_not_approved` |
| A3 | The agent's **key** in Secret `agentfactory-agent`, key `AGENTFACTORY_KEY`, in namespace `sast` | the SAST pods read it from there |
| A4 | **Models** the agent may name, priced, cleared for confidential data. Used here: `google/gemini-4-argon` (default), `gemini-4-carbon`, `gemini-4-neon`, `gemini-3.1-pro-preview`, `gemini-2.5-pro` | the scan names the model picked in SAST's settings |
| A5 | **Caps**: a per-run guardian stop (here $20; $40 planned for Claude) and a daily cap (here $100) | a top-tier scan costs more than $5 |
| A6 | A **database** `sast` on the AlloyDB instance, with users `sast` (owner) and `sast_app` (application), Secrets `sast-db` and `sast-db-app` (keys `PGHOST PGPORT PGDATABASE PGUSER PGSSLMODE PGPASSWORD`), and the statements below | SAST's set-up runs as the owner, the services as `sast_app` |
| A7 | **Sign-in**: an Ingress with IAP, a BackendConfig, and a Service `sast-web` selecting pods `app: sast-web` on a port named `http`, health on `/healthz`; the IAP audience (`/projects/NUMBER/global/backendServices/ID`); the people's emails in ConfigMap `sast-admins`, key `ADMIN_EMAILS` | SAST's web pods slot into it |
| A8 | Namespace `sast` able to reach the Saros Service (pods on 8080) and AlloyDB (5432, `sslmode=require`); Cloud NAT for outbound (GitHub, `www.gstatic.com` for IAP keys) | the agent calls the platform inside the cluster |

The database statements (A6), run once by the instance admin on database `sast`, because the
owner `sast` may not create roles:

```sql
CREATE ROLE sast_app LOGIN;
\password sast_app                                     -- psql asks twice; the same value into Secret sast-db-app
GRANT CONNECT ON DATABASE sast TO sast_app;
GRANT USAGE ON SCHEMA public TO sast_app;
CREATE ROLE saros_staff_definer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT saros_staff_definer TO sast;
GRANT USAGE, CREATE ON SCHEMA public TO sast WITH GRANT OPTION;
REVOKE TEMPORARY ON DATABASE sast FROM PUBLIC;
REVOKE CONNECT ON DATABASE sast FROM PUBLIC;          -- only the users granted it may connect
```

The full database steps, the owner user included, are in the Saros half, step S8.

### B. SAST side

#### B1. Build the images (linux/amd64)

From the SAROS SAST repository, at the version above:

```bash
R=REGION-docker.pkg.dev/PROJECT/REPOSITORY
T=$(git rev-parse --short HEAD)
docker buildx build --platform linux/amd64 -f deploy/docker/Dockerfile.api -t $R/sast-backend:$T --push .
docker buildx build --platform linux/amd64 -f deploy/docker/Dockerfile.web \
  --build-arg SAROS_API_UPSTREAM=http://saros-backend -t $R/sast-web:$T --push .
```

The API image installs the vendored SDK first (never from PyPI).

#### B2. Values file

Keep it outside the repository (it names your hosts and people). Start from
`deploy/gke/helm/saros/ci/saros-platform.yaml` and set:

```yaml
image: {repository: REGISTRY/sast-backend, tag: TAG}
web:
  enabled: true
  image: {repository: REGISTRY/sast-web, tag: TAG}
  appLabel: sast-web                      # the Saros team's Service selects this
  service: {create: false, name: sast-web}  # never replace their Service
serviceAccount: {name: saros-backend, annotations: {}}   # no Google service account
autoscaling: {enabled: false}
replicaCount: 1
podDisruptionBudget: {enabled: false}
keda: {enabled: false}
workers: {mode: deployment}
dastWorker: {enabled: false}
scanWorker:    {replicaCount: 1, env: {SAROS_DB_URL: "postgresql+psycopg://sast_app@DB_HOST:5432/sast?sslmode=require"}}
relayNotifier: {replicaCount: 1, env: {SAROS_DB_URL: "postgresql+psycopg://sast_app@DB_HOST:5432/sast?sslmode=require"}}
reaper:        {env: {SAROS_DB_URL: "postgresql+psycopg://sast_app@DB_HOST:5432/sast?sslmode=require"}}
gateway:       {env: {SAROS_DB_URL: "postgresql+psycopg://sast_app@DB_HOST:5432/sast?sslmode=require"}}
dbBootstrap:
  enabled: true
  adminDbUrl: "postgresql+psycopg://sast@DB_HOST:5432/sast?sslmode=require"
  adminDbAuth: password
  serviceRolesJson: '[{"role":"sast_app","service":"all"}]'
  passwordSecret: {name: sast-db, key: PGPASSWORD}        # the owner's password, set-up only
env:
  SAROS_CLOUD: generic              # password sign-in to the database
  SAROS_MODEL_PROVIDER: vertex      # Vertex model names; calls go to the gateway
  SAROS_BUS: sql                    # the relay needs the database bus
  SAROS_AUTH: iap
  SAROS_IAP_AUDIENCE: "/projects/NUMBER/global/backendServices/ID"  # pragma: allowlist secret
  SAROS_IAP_ROLE_SOURCE: list
  SAROS_IAP_ROLES: '{"platform-admin": ["user:ADMIN_EMAIL_1", "user:ADMIN_EMAIL_2"]}'
  SAROS_SWEEP_CONCURRENCY_MAX: "8"
  AGENTFACTORY_ENDPOINT: http://agentfactory.agentfactory.svc.cluster.local
  AGENTFACTORY_MODEL: scan          # name the model picked in Settings on each call
  AGENTFACTORY_REASONING_EFFORT: "1"  # the gateway takes reasoning_effort (Saros 93934e2 or later)
secretEnv:
  - {name: AGENTFACTORY_KEY, secret: agentfactory-agent, key: AGENTFACTORY_KEY}
  - {name: PGPASSWORD, secret: sast-db-app, key: PGPASSWORD}
networkPolicy:
  enabled: true
  cloudSqlHost: DB_HOST
  platformNamespace: agentfactory
  gatewayInternet: true             # IAP keys from www.gstatic.com
  dnsAnywhere: true                 # Dataplane V2 clusters: DNS to kube-dns needs this
egress: {mode: direct}
```

Role names are `platform-admin`, `analyst`, `reviewer`, `auditor`; each person is `user:EMAIL`
(or `domain:DOMAIN`), exactly as IAP names them.

#### B3. Install

```bash
C=KUBE_CONTEXT          # name the cluster on every command
# The set-up job runs before Helm makes anything else, so on the first install its service
# account must exist; label it so Helm adopts it.
kubectl --context $C apply -f - <<'EOF'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: saros-backend
  namespace: sast
  labels: {app.kubernetes.io/managed-by: Helm}
  annotations: {meta.helm.sh/release-name: sast, meta.helm.sh/release-namespace: sast}
EOF
helm --kube-context $C -n sast upgrade --install sast deploy/gke/helm/saros -f VALUES --wait --timeout 10m
kubectl --context $C -n sast get pods          # five Running
kubectl --context $C -n sast logs job/saros-db-bootstrap   # if the set-up fails: says why
```

Later versions: `helm upgrade ... --set image.tag=NEW --set web.image.tag=NEW` (or edit VALUES).

#### B4. Check, in order

1. `kubectl --context $C -n sast exec deploy/saros-scan-worker -- saros platform-check`:
   `"ok": true`, the models listed, `finding_record: true`. A 403 `attachment_not_approved` means A2
   is not approved yet.
2. The sign-in address redirects to Google; after sign-in the screens load.
3. In Settings → Model provider: permit **Gemini 4 Argon** (and any other model Saros allows),
   make it the default, remove models Saros does not allow. Models without a built-in price
   (Carbon, Neon) need one under Model prices.
4. Start a scan of a small public repository with known bugs. The worker logs
   `Saros: scan ID is run RUN_ID URL`; the run shows in the Saros console with its steps and model
   calls, and the findings appear under Workloads → SAST and Findings.

### How a scan behaves under Saros

- **Model Armor.** A tool result it refuses (a file's content) is replaced by
  `[withheld by screening: CONTROL]` for the rest of the run, a step names the control, and the scan
  carries on. A reply refused because the model quoted a secret is asked for once more, masked.
  Findings sent to Saros have secret values masked.
- **Caps.** Past the daily cap the gateway answers 402: the scan stops and the run fails naming
  the cap. Past the per-run cap the guardian stops the run: the scan stops and the run ends killed.
- **Stop.** A stop in the Saros console stops the scan within about a minute.
- **Rate.** No per-agent limit in Saros; the ceiling is Vertex's quota. 8 calls in parallel; a 429
  is retried after its `Retry-After`.

### Problems met the first time, and the fix

| Seen | Cause | Fix |
|---|---|---|
| Set-up job never starts: `serviceaccount "saros-backend" not found` | the pre-install hook runs before the chart makes the account | create it first (B3) |
| Set-up fails: `permission denied to create role` / `must be able to SET ROLE` | the owner may not create roles | the admin statements in A6 |
| Set-up check: `may create TEMPORARY objects` | PUBLIC holds TEMPORARY on new databases | `REVOKE TEMPORARY ON DATABASE sast FROM PUBLIC` |
| API crash: `'administrator' is not a role` / `not user:<email>` | role names and entries | `platform-admin`, `user:EMAIL` |
| Relay crash: `set SAROS_BUS=...` | the relay needs a shared bus | `SAROS_BUS: sql` |
| `Temporary failure in name resolution` from every pod | DNS to kube-dns blocked by the pod-selector rule on this cluster | `networkPolicy.dnsAnywhere: true` |
| Browser shows Google "Server Error" after install, and it stays | the load balancer's health check was made before the pods existed and asks `/` | the Saros team sets the check to `/healthz` on the web container's port in the BackendConfig (Saros half, S9); waiting does not fix it |
| Scan partial: `503 screener_unavailable` | Saros sent empty files to Model Armor | fixed in Saros |
| A finding lost: `400 response_screened ... sdp ... PASSWORD` | the model quoted a hard-coded password | fixed in SAST (mask and retry once) |

### Limits now

- **Private repositories**: not yet; storing a repository token needs Google Secret Manager, i.e. a
  Google service account, which this setup does not use. The alternative (tokens encrypted in the
  SAST database) is not built.
- **Runtime proof (DAST)**: off, until the Saros team has tuned Model Armor on real SAST content.
- **Claude models**: need Saros's Model Garden connector and Claude enabled in the project's Model
  Garden by someone allowed to accept Anthropic's terms.

The settings, chart options and code are described in [saros-platform.md](saros-platform.md).
