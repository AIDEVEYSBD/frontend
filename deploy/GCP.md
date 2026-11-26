# Deploying on Google Cloud

This guide is for the DevOps engineers who deploy Saros into their own Google Cloud project, using the two
repositories and this guide. It assumes you know Google Cloud, GKE and Cloud Run. It explains only the product.
The product is Saros; its machine names are `agentfactory`: the Python package, the image names, the Kubernetes
namespaces and objects, and the Google Cloud resources this guide creates. Use them as written.

**The same file is in both repositories, at `deploy/GCP.md`**: the backend (the service) and the console. Follow either
copy. File paths in this guide are in the backend repository, except those under `deploy/console/` and those this guide
says are the console's. Both repositories have a `README.md`, a `Dockerfile` and a `.env.example`; where it matters,
the guide says whose.

Follow it top to bottom. Every setting name, default and behaviour below comes from the backend's code: `agentfactory/settings.py`,
`.env.example`, `agentfactory/preflight.py`, `agentfactory/guard/`, `agentfactory/providers/`,
`agentfactory/knowledge/connectors/`, `agentfactory/assurance/` and `deploy/k8s/`. Every Google step links the Google
page it comes from. Values in CAPITALS are placeholders.

**Read section 15 before you start.** Vertex AI, Model Armor, Secret Manager, IAP, the buckets, Security Command Center,
GKE and AlloyDB have never been run against real Google services. Each was written from Google's documentation and
checked only against local stand-ins. Section 15 lists what to verify on the first day.

Contents:

0. [Values to choose first](#0-values-to-choose-first)
1. [The shape](#1-the-shape)
2. [The project](#2-the-project)
3. [AlloyDB for PostgreSQL](#3-alloydb-for-postgresql)
4. [GKE](#4-gke)
5. [Service accounts and IAM](#5-service-accounts-and-iam)
6. [Vertex AI models](#6-vertex-ai-models)
7. [Model Armor](#7-model-armor)
8. [Secret Manager](#8-secret-manager)
9. [Cloud Storage](#9-cloud-storage)
10. [The console on Cloud Run behind IAP](#10-the-console-on-cloud-run-behind-iap)
11. [The machine route](#11-the-machine-route)
12. [Optional integrations](#12-optional-integrations)
13. [Bring-up and checks](#13-bring-up-and-checks)
14. [Operating it](#14-operating-it)
15. [What is proven and what is not](#15-what-is-proven-and-what-is-not)

---

## 0. Values to choose first

Several settings name things that are created later: the console's IAP audience, the backend's internal address, the
machines' address. Choose them now and use the same values everywhere.

```sh
PROJECT_ID=PROJECT_ID
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
GCP_REGION=REGION                  # GKE, AlloyDB, Cloud Run, the buckets, Model Armor, the certificate
VERTEX_LOCATION=global             # where models are called (section 6): global, us, eu or a region
NETWORK=agentfactory-vpc
CLUSTER=agentfactory
REPOSITORY=agentfactory            # Artifact Registry, Docker format
BACKEND_IMAGE=$GCP_REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/agentfactory:TAG
CONSOLE_IMAGE=$GCP_REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/agentfactory-console:TAG
CONSOLE_SERVICE=agentfactory-console
BACKEND_GSA=agentfactory-backend@$PROJECT_ID.iam.gserviceaccount.com
CONSOLE_GSA=agentfactory-console@$PROJECT_ID.iam.gserviceaccount.com
FILES_BUCKET=$PROJECT_ID-agentfactory-files
API_HOST=api.example.com           # the machines' host name (section 11)
```

What follows from them:

| Value | Where it is used | Section |
|---|---|---|
| `https://$CONSOLE_SERVICE-$PROJECT_NUMBER.$GCP_REGION.run.app` (or your own domain) | the console's `NEXT_PUBLIC_ORIGIN` at build; the backend's `PUBLIC_ORIGIN` | 10 |
| `/projects/$PROJECT_NUMBER/locations/$GCP_REGION/services/$CONSOLE_SERVICE` | the backend's `IAP_AUDIENCE` | 10 |
| a reserved internal IP for the backend, `BACKEND_ILB_IP` | the console's `BACKEND_ORIGIN=http://BACKEND_ILB_IP` | 2.3, 10 |
| `https://$API_HOST` | the backend's `PUBLIC_API_URL` (and `A2A_PUBLIC_URL` when peers use the same host) | 11 |

---

## 1. The shape

```
people ──HTTPS──► IAP ──► console (Cloud Run) ──Direct VPC egress──► internal passthrough LB :80 ──┐
                          BACKEND_ORIGIN                              (source: the Cloud Run subnet) │
                                                                                                    ▼
machines ──HTTPS──► internal Application LB :443 ─────────────────────────────────────► backend pods (GKE)
applications, SDK agents,  (GKE Gateway, TLS,                                           namespace agentfactory
triggers, webhooks,        machine paths only)                                                │
MCP clients, A2A peers     PUBLIC_API_URL                                                     │ Workload Identity
                                                                                              ├──► AlloyDB (private IP)
                                                                                              ├──► Vertex AI, Model Armor, Secret Manager,
                                                                                              │    Cloud Storage, Security Command Center,
                                                                                              │    IAP API, www.gstatic.com (IAP's keys)
                                                                                              └──► sandbox Jobs: namespace agentfactory-sandbox,
                                                                                                   gVisor node pool, no network
```

- **People** reach the console through Identity-Aware Proxy (IAP). IAP signs each request (`x-goog-iap-jwt-assertion`).
  The console forwards every `/api` request, and the agent card at `/.well-known/agent.json`, to the backend with its
  headers unchanged. The console keeps no data and no session, and decides nothing. The backend checks the assertion's
  signature, issuer, audience (`IAP_AUDIENCE`) and expiry on **every** request. It gives the person the roles that
  `IAP_ROLE_MAP` names. Nobody the map does not name has any access.
- **The console-to-backend hop** is not covered by IAP. Anything that reaches the backend on it can act as a person
  only with an assertion that Google signed for this audience. Restrict the load balancer to the Cloud Run egress subnet
  anyway (section 10).
- **Machines** cannot pass IAP. They use a second route, which IAP does not cover. On that route each door has its own
  authentication, and it is the only gate (section 11). `PUBLIC_API_URL` names that route, and the console prints every
  machine address from it.

The backend is one image with several modes (`python -m agentfactory MODE`): `api` (the default), `worker`, `migrate`,
`preflight`, `verify-audit` and `doors`. The console is a second image, built from the console repository.

---

## 2. The project

### 2.1 APIs

```sh
gcloud services enable \
  compute.googleapis.com servicenetworking.googleapis.com alloydb.googleapis.com \
  container.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  cloudresourcemanager.googleapis.com iamcredentials.googleapis.com \
  run.googleapis.com iap.googleapis.com \
  aiplatform.googleapis.com modelarmor.googleapis.com secretmanager.googleapis.com \
  storage.googleapis.com certificatemanager.googleapis.com dns.googleapis.com \
  --project=$PROJECT_ID
```

Sources:
[AlloyDB on GKE quickstart](https://docs.cloud.google.com/alloydb/docs/quickstart/integrate-kubernetes),
[IAP for Cloud Run](https://docs.cloud.google.com/iap/docs/enabling-cloud-run),
[Model Armor templates](https://docs.cloud.google.com/model-armor/manage-templates),
[Serverless VPC Access](https://docs.cloud.google.com/vpc/docs/configure-serverless-vpc-access) (only if you use a
connector instead of Direct VPC egress: `vpcaccess.googleapis.com`).

For the optional integrations (section 12): Security Command Center needs to be activated for the project or
organization. The OpenTelemetry collector writes through `telemetry.googleapis.com`, `cloudtrace.googleapis.com`,
`logging.googleapis.com` and `monitoring.googleapis.com`; Google enables these
[by default in new projects](https://docs.cloud.google.com/service-usage/docs/enabled-service).

### 2.2 Region

Put GKE, AlloyDB, Cloud Run, the buckets, the Model Armor template and the regional certificate in one region
(`GCP_REGION`). Check that the region is on
[Model Armor's location list](https://docs.cloud.google.com/model-armor/locations).

The Vertex AI location is a separate choice, because the backend's `REGION` setting is the location where models are
called. It is not the cluster's region (section 6). Security Command Center findings are read in
`SECURITY_FINDINGS_LOCATION`: `global`, or `eu`, `us` or `sa` if your organization has data residency on (section 12).

### 2.3 Network

One VPC with four subnets and a reserved range for AlloyDB. The ranges below are examples.

```sh
gcloud compute networks create $NETWORK --subnet-mode=custom --project=$PROJECT_ID

# GKE nodes, with secondary ranges for Pods and Services (VPC-native).
gcloud compute networks subnets create gke-nodes --network=$NETWORK --region=$GCP_REGION \
  --range=10.10.0.0/20 --secondary-range=pods=10.20.0.0/14,services=10.24.0.0/20 \
  --enable-private-ip-google-access

# Cloud Run's Direct VPC egress: /26 or larger.
gcloud compute networks subnets create run-egress --network=$NETWORK --region=$GCP_REGION --range=10.11.0.0/26

# The proxy-only subnet the internal Application Load Balancer needs (section 11).
gcloud compute networks subnets create proxy-only --purpose=REGIONAL_MANAGED_PROXY --role=ACTIVE \
  --region=$GCP_REGION --network=$NETWORK --range=10.12.0.0/23

# Private services access, for AlloyDB.
gcloud compute addresses create alloydb-range --global --purpose=VPC_PEERING --prefix-length=16 \
  --description="AlloyDB" --network=$NETWORK
gcloud services vpc-peerings connect --service=servicenetworking.googleapis.com \
  --ranges=alloydb-range --network=$NETWORK

# The backend's internal address for the console (section 10): in the GKE subnet's primary range.
gcloud compute addresses create agentfactory-backend-ilb --region=$GCP_REGION --subnet=gke-nodes
BACKEND_ILB_IP=$(gcloud compute addresses describe agentfactory-backend-ilb --region=$GCP_REGION --format='value(address)')
```

Sources:
[VPC-native clusters](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/alias-ips),
[Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc),
[proxy-only subnet](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/deploying-gateways),
[AlloyDB private services access](https://docs.cloud.google.com/alloydb/docs/configure-connectivity),
[internal LoadBalancer parameters](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/service-load-balancer-parameters).

**Pod and Service ranges.** A tool call or knowledge fetch never reaches a private, loopback or link-local address.
If you keep the Pod and Service ranges in RFC 1918 space, as above, they are refused already. GKE's default Service
range, `34.118.224.0/20` (GKE Standard 1.29 and later,
[source](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/alias-ips)), is public address space. If you use
it, or any other public range privately, list it in `DENIED_ADDRESS_RANGES` (section 4.5).

### 2.4 What the backend calls out to

Give your firewall team this list. With private nodes, give the cluster Cloud NAT (below), or provide each of these
another way.

| Destination | For | Setting |
|---|---|---|
| AlloyDB private IP, port 5432 | the database | `DATABASE_URL` |
| `www.gstatic.com` | IAP's public keys, read to check every sign-in | `IAP_JWKS_URL` (a mirror, if this host cannot be reached) |
| the GKE metadata server (on the node) | the Google identity | none |
| `aiplatform.googleapis.com`, or `REGION-aiplatform.googleapis.com`, or `aiplatform.eu.rep.googleapis.com` / `aiplatform.us.rep.googleapis.com` | models, embeddings, model lists | `REGION`, `VERTEX_ENDPOINT` |
| `modelarmor.LOCATION.rep.googleapis.com` | screening | `MODEL_ARMOR_TEMPLATE` |
| `secretmanager.googleapis.com` | the vault, with `SECRETS=secret-manager` | `SECRETS` |
| `storage.googleapis.com` | the files bucket and knowledge buckets | `FILES_BUCKET` |
| `securitycenter.googleapis.com` | findings (optional) | `SECURITY_FINDINGS_*` |
| `iap.googleapis.com` | the IAP access list shown on the identity pages (optional) | none |
| the cluster's Kubernetes API | sandbox Jobs | `SANDBOX` |
| the OpenTelemetry collector | traces and forwarded logs (optional) | `OTEL_EXPORTER_OTLP_ENDPOINT` |
| tool servers, `EGRESS_HOSTS`, knowledge source hosts | what agents use | per tool and source |
| another OpenAI-compatible endpoint (optional) | models | `MODEL_ENDPOINT` |

Cloud NAT for the cluster's region:

```sh
gcloud compute routers create agentfactory-router --network=$NETWORK --region=$GCP_REGION
gcloud compute routers nats create agentfactory-nat --router=agentfactory-router --region=$GCP_REGION \
  --nat-all-subnet-ip-ranges --auto-allocate-nat-external-ips
```

Sources: [Cloud Router](https://docs.cloud.google.com/network-connectivity/docs/router/how-to/create-router-vpc-network),
[Cloud NAT](https://docs.cloud.google.com/nat/docs/set-up-manage-network-address-translation).

**Model Armor from private nodes.** Private Google Access carries `*.googleapis.com` and `www.gstatic.com`, but not the
regional endpoints (`*.rep.googleapis.com`): without Cloud NAT, a call to `modelarmor.LOCATION.rep.googleapis.com`
times out, and with `SCREENER_UNAVAILABLE=block` every model call is then refused. With Cloud NAT the public endpoint
should answer over NAT; that was not tested. Without NAT, or under VPC Service Controls, give it a Private Service
Connect regional endpoint and a private DNS zone that only your VPC sees:

```sh
gcloud services enable networkconnectivity.googleapis.com --project=$PROJECT_ID
gcloud network-connectivity regional-endpoints create agentfactory-modelarmor --region=$GCP_REGION \
  --network=projects/$PROJECT_ID/global/networks/$NETWORK \
  --subnetwork=projects/$PROJECT_ID/regions/$GCP_REGION/subnetworks/gke-nodes \
  --target-google-api=modelarmor.$GCP_REGION.rep.googleapis.com
MA_IP=$(gcloud network-connectivity regional-endpoints describe agentfactory-modelarmor --region=$GCP_REGION \
  --format='value(address)')
gcloud dns managed-zones create agentfactory-modelarmor --dns-name=modelarmor.$GCP_REGION.rep.googleapis.com. \
  --networks=$NETWORK --visibility=private --description="Model Armor through Private Service Connect"
gcloud dns record-sets create modelarmor.$GCP_REGION.rep.googleapis.com. --rrdatas=$MA_IP --type=A --ttl=300 \
  --zone=agentfactory-modelarmor
```

Source: [regional endpoints through Private Service Connect](https://docs.cloud.google.com/vpc/docs/access-regional-google-apis-endpoints).
A first real run used exactly this, and preflight's screener check then passed without NAT.

The sandbox nodes pull `SANDBOX_IMAGE` (section 4.3). Mirror it into Artifact Registry so that private nodes do not
need Docker Hub.

---

## 3. AlloyDB for PostgreSQL

The backend keeps everything in one Postgres database with the `vector` extension (pgvector). There is no second store.

### 3.1 Cluster and instance, private IP

```sh
POSTGRES_ADMIN_PASSWORD="$(openssl rand -hex 24)"    # AlloyDB's postgres user: keep it in your password manager
gcloud alloydb clusters create agentfactory \
    --database-version=POSTGRES_16 \
    --password="$POSTGRES_ADMIN_PASSWORD" \
    --region=$GCP_REGION \
    --project=$PROJECT_ID \
    --network=$NETWORK \
    --allocated-ip-range-name=alloydb-range

gcloud alloydb instances create agentfactory-primary \
    --instance-type=PRIMARY \
    --availability-type=REGIONAL \
    --region=$GCP_REGION \
    --cluster=agentfactory \
    --cpu-count=4 \
    --project=$PROJECT_ID

ALLOYDB_IP=$(gcloud alloydb instances describe agentfactory-primary --cluster=agentfactory \
  --region=$GCP_REGION --format='value(ipAddress)')
```

Sources: [create a cluster](https://docs.cloud.google.com/alloydb/docs/cluster-create),
[create a primary instance](https://docs.cloud.google.com/alloydb/docs/instance-primary-create),
[the instance's `ipAddress`](https://docs.cloud.google.com/alloydb/docs/reference/rest/v1/projects.locations.clusters.instances).

- `--password` sets the password of AlloyDB's `postgres` user ("Initial postgres user password to set up during
  cluster creation", [flags](https://docs.cloud.google.com/sdk/gcloud/reference/alloydb/clusters/create)), which you
  need once in 3.2. It is made in the shell and never written into a file.
- **Postgres 16** is the version the backend was rehearsed on, with pgvector 0.8.6. On AlloyDB for PostgreSQL 16 the
  extension reported `0.8.7.google-1` (November 2026), and every migration applied on it. AlloyDB's own default version
  is newer and has not been run against this backend
  ([extensions](https://docs.cloud.google.com/alloydb/docs/reference/extensions)).
- Private Service Connect is an alternative to private services access. Replace `--network` with
  `--enable-private-service-connect` and follow the cluster page.

### 3.2 The database, the user and the `vector` extension

On AlloyDB, "only database users who are members of the `alloydbsuperuser` role can run the `CREATE EXTENSION`
command. By default, this includes the `postgres` user"
([extensions](https://docs.cloud.google.com/alloydb/docs/reference/extensions)). The backend's migration
`0003_knowledge.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`. The backend's own user is not a superuser, so create
the extension first, as `postgres`, **connected to the backend's database**. The migration then finds it and goes on.
That order was rehearsed on plain Postgres (the backend's README.md, "Database"); it has not been rehearsed on AlloyDB.

First make the backend's own password, in your own shell (not in the pod), and keep it in your password manager too:

```sh
AGENTFACTORY_DB_PASSWORD="$(openssl rand -hex 24)"
```

Connect as `postgres` from a machine in the VPC: AlloyDB Studio in the Cloud console, or, once the cluster exists
(4.1), a throwaway pod. The pod's image is pulled from Docker Hub, so it needs Cloud NAT or a mirror:

```sh
kubectl run psql --rm -it --restart=Never --namespace default --image=postgres:16 -- \
  psql "host=$ALLOYDB_IP user=postgres dbname=postgres sslmode=require"
```

Then, with the grants Google's [GKE quickstart](https://docs.cloud.google.com/alloydb/docs/quickstart/integrate-kubernetes)
uses:

```sql
CREATE DATABASE agentfactory;
CREATE USER agentfactory;
\password agentfactory
GRANT ALL PRIVILEGES ON DATABASE "agentfactory" TO "agentfactory";
\c agentfactory
GRANT CREATE ON SCHEMA public TO "agentfactory";
CREATE EXTENSION IF NOT EXISTS vector;
```

`\password` asks twice for the new password: paste the value of `$AGENTFACTORY_DB_PASSWORD`. psql "prompts for the new
password, encrypts it, and sends it to the server as an `ALTER ROLE` command. This makes sure that the new password does
not appear in cleartext in the command history, the server log, or elsewhere"
([psql](https://www.postgresql.org/docs/16/app-psql.html)). `\password` is a psql command: run this step in psql, in
the pod above. It has not been rehearsed on AlloyDB.

### 3.3 `DATABASE_URL` and `PGPASSWORD`

```
DATABASE_URL=postgresql://agentfactory@ALLOYDB_IP:5432/agentfactory?sslmode=require
```

- The address carries no password. The backend connects with psycopg, which uses libpq, and libpq reads the password
  from the environment variable `PGPASSWORD` ("behaves the same as the password connection parameter",
  [libpq](https://www.postgresql.org/docs/16/libpq-envars.html)). The settings Secret carries it (4.5), so every
  workload that reads the Secret (the backend, separate workers, the migrate Job) has it. Nothing in the backend reads
  or removes it; it needs no URL encoding.
- libpq's page adds that the variable "is not recommended for security reasons, as some operating systems allow
  non-root users to see process environment variables via `ps`", and suggests a password file. In this deployment the
  variable is set only inside the backend's containers, from the Secret; restrict who may `kubectl exec` into them
  and who may read Secrets in the namespace.
- "By default, an AlloyDB instance accepts only connections using SSL"
  ([source](https://docs.cloud.google.com/alloydb/docs/instance-ssl)). Direct connections "don't support client
  certificates or higher SSL modes, `verify-ca` and `verify-full`"
  ([source](https://docs.cloud.google.com/alloydb/docs/choose-alloydb-connectivity)), so use `sslmode=require`.
- The backend connects directly to the private IP with psycopg. The AlloyDB Auth Proxy and the Language Connectors are
  not used. Google recommends them over direct connections because of IAM authorization and mTLS; the backend does not
  support either.
- The backend's own Google service account needs no AlloyDB role. It signs in with this password.

### 3.4 Running `migrate`

`python -m agentfactory migrate` applies the numbered SQL files in `agentfactory/migrations/` that are not yet
recorded in `schema_migrations`, prints them and exits. It holds a session advisory lock while it works, so two
processes starting together never both migrate. Put no transaction-mode connection pooler between the backend and
AlloyDB.

There are two ways to run it:

- `AUTO_MIGRATE=1` (the default): every `api` process migrates as it starts.
- `AUTO_MIGRATE=0`: migrate as its own step, before each rollout. This guide uses this way (section 4.6) so that an
  upgrade migrates exactly once, before any new pod starts.

### 3.5 Connection pool size against AlloyDB's limits

Each backend process holds up to `DB_POOL_SIZE` connections (default 20). Worker threads share their process's pool.
One run uses at most 8 threads (`engine/plan.py`, `MAX_THREADS`). Add up the connections:

```
api pods × DB_POOL_SIZE  +  worker pods × DB_POOL_SIZE  +  10 (the migrate Job's pool ceiling)  +  2 (preflight)
  +  your own psql sessions  ≤  max_connections, with headroom
```

Google's two pages give different defaults for `max_connections`.
[Quotas](https://docs.cloud.google.com/alloydb/quotas) gives one by machine size: 100 for 1 or 2 vCPUs, 200 for 4, 400
for 8, up to 1000. The [database flags reference](https://docs.cloud.google.com/alloydb/docs/reference/database-flags)
lists 1000. Read the real value with `SHOW max_connections;` as `postgres`.

To change it:

```sh
gcloud alloydb instances update agentfactory-primary --database-flags=max_connections=400 \
  --region=$GCP_REGION --cluster=agentfactory --project=$PROJECT_ID
```

This "overwrites all database flags that are previously set" and may restart the instance
([source](https://docs.cloud.google.com/alloydb/docs/instance-configure-database-flags)).

A process that cannot get a connection waits for one, then fails what it was doing with the pool's timeout error.

Backups are in section 14.

---

## 4. GKE

### 4.1 The cluster, with Workload Identity and network policy

A Standard regional cluster. It needs:

- VPC-native networking;
- Workload Identity Federation for GKE;
- GKE Dataplane V2, which enforces NetworkPolicy (the sandbox depends on it, section 4.8);
- the Gateway API (section 11).

Dataplane V2 can be set only when the cluster is created.

```sh
gcloud container clusters create $CLUSTER \
  --project=$PROJECT_ID --location=$GCP_REGION \
  --network=$NETWORK --subnetwork=gke-nodes \
  --enable-ip-alias --cluster-secondary-range-name=pods --services-secondary-range-name=services \
  --workload-pool=$PROJECT_ID.svc.id.goog \
  --enable-dataplane-v2 \
  --gateway-api=standard \
  --num-nodes=1

gcloud container clusters get-credentials $CLUSTER --location=$GCP_REGION --project=$PROJECT_ID
```

Add your organization's private-cluster and node service account flags. Every node pool that runs the backend must
use the GKE metadata server (`--workload-metadata=GKE_METADATA`; Google's page shows the flag for pools that lack it).

Check the organization policies that apply to the project before you create the cluster
(`gcloud resource-manager org-policies describe constraints/NAME --project=$PROJECT_ID --effective`). Two that a
first real run met:

- `constraints/compute.requireShieldedVm`: GKE does not turn Secure Boot on by default, so every node fails to start
  ("Secure Boot is not enabled in the 'shielded_instance_config' field") and the cluster ends in `ERROR`. Add
  `--shielded-secure-boot --shielded-integrity-monitoring` to the cluster and to every node pool, the sandbox pool (4.2)
  included.
- `constraints/compute.vmExternalIpAccess`: nodes may not have external addresses. Add `--enable-private-nodes`;
  outbound traffic then needs Cloud NAT (2.4). Google APIs are reached through Private Google Access on the subnet.

A cluster created with `--enable-private-nodes` has authorized networks switched on with no network listed, so
`kubectl` from outside the VPC hangs. Either list your administrators' ranges
(`--master-authorized-networks`), or use the DNS-based endpoint, which admits only callers with IAM permission on the
cluster:

```sh
gcloud container clusters update $CLUSTER --location=$GCP_REGION --enable-dns-access
gcloud container clusters get-credentials $CLUSTER --location=$GCP_REGION --project=$PROJECT_ID --dns-endpoint
```

Sources: [`clusters create` reference](https://docs.cloud.google.com/sdk/gcloud/reference/container/clusters/create),
[Workload Identity Federation for GKE](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity),
[Dataplane V2](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/dataplane-v2),
[Gateway](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/deploying-gateways).

### 4.2 The GKE Sandbox node pool

The code agents write runs in a gVisor node pool of its own:

```sh
gcloud container node-pools create sandbox \
    --cluster=$CLUSTER \
    --location=$GCP_REGION \
    --sandbox=type=gvisor \
    --image-type=COS_CONTAINERD \
    --machine-type=MACHINE_TYPE \
    --num-nodes=1
```

Source: [GKE Sandbox](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/sandbox-pods). Google's requirements:

- Container-Optimized OS with containerd;
- not the default node pool;
- the cluster always keeps at least one node pool without GKE Sandbox.

GKE labels and taints these nodes (`sandbox.gke.io/runtime=gvisor`). A Pod with `runtimeClassName: gvisor` gets the
matching affinity and toleration automatically
([concepts](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/sandbox-pods)).

### 4.3 Images

```sh
gcloud artifacts repositories create $REPOSITORY --repository-format=docker --location=$GCP_REGION

# The backend, from the backend repository's root.
gcloud builds submit --tag $BACKEND_IMAGE .

# The sandbox image, mirrored and named by digest.
docker pull python:3.12-slim
docker tag python:3.12-slim $GCP_REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/python:3.12-slim
docker push $GCP_REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/python:3.12-slim
docker inspect --format='{{index .RepoDigests 0}}' $GCP_REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/python:3.12-slim
```

The last line prints `…/python@sha256:…`; that is `SANDBOX_IMAGE`. The default, `python:3.12-slim`, is a tag on Docker
Hub. Give the nodes' service account `roles/artifactregistry.reader` on the repository. The console image is built in
section 10.

### 4.4 The backend's Google service account

```sh
gcloud iam service-accounts create agentfactory-backend --display-name="Saros backend"

gcloud iam service-accounts add-iam-policy-binding $BACKEND_GSA \
    --role roles/iam.workloadIdentityUser \
    --member "serviceAccount:$PROJECT_ID.svc.id.goog[agentfactory/agentfactory]"
```

`deploy/k8s/backend.yaml` makes the Kubernetes service account `agentfactory/agentfactory` and annotates it with
`iam.gke.io/gcp-service-account`. Google requires both that annotation and this binding for this way of linking
([source](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)). This guide links the
Kubernetes account to a Google service account rather than granting roles to the Kubernetes principal directly. The
reason: Google's [list of services that support the direct method](https://docs.cloud.google.com/iam/docs/federated-identity-supported-services)
does not name Model Armor. The roles themselves are in section 5.

The backend asks the metadata server for `instance/service-accounts/default/token` and uses that token for every
Google call (`agentfactory/providers/google.py`). The GKE metadata server serves `instance/zone` and
`project/project-id` but not `instance/region`
([source](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/workload-identity)). With `REGION` unset, the
backend takes the node's zone without its last part (`europe-west1-b` → `europe-west1`). Set `GCP_PROJECT` and `REGION`
yourself (section 6).

### 4.5 The backend Deployment, its Service and the settings Secret

`deploy/k8s/backend.yaml` holds:

- the namespace `agentfactory`;
- the service account `agentfactory`, which has no Kubernetes role in its own namespace;
- the Deployment `agentfactory`, which runs `api` with worker threads beside it;
- the Service `agentfactory`, port 80 → container port 8080.

The Deployment runs non-root (uid 10001) with a read-only root file system and no capabilities; `/tmp` is the only
place it writes. Its probes use `/healthz`, which answers whether the process and its database answer.
The backend's `deploy/k8s/README.md` says what each object is for.

Replace the two placeholders in `backend.yaml`: the image (`BACKEND_IMAGE`, by digest if you can) and the annotation
(`BACKEND_GSA`). Then apply it and hold the Deployment at zero replicas until the schema exists (4.6):

```sh
kubectl apply -f deploy/k8s/backend.yaml
kubectl scale deployment/agentfactory --replicas=0 --namespace agentfactory
```

Why: with `AUTO_MIGRATE=0`, an `api` process that starts on an empty database fails at start, because it writes its
worker announcement into the `workers` table before it serves (`work/worker.py`). Kubernetes would restart it until the
schema exists.

The pod does not start until the Secret `agentfactory-settings` exists. Write the settings to a file, `settings.env`.
The file takes one `NAME=value` per line. Values are taken literally: no `export`, no quotes, and JSON written as it
is. Lines starting with `#` are ignored. Never put a comment after a value on the same line, because it becomes part of
the value. Never `source` the file in a shell: the shell strips the quotes inside JSON values.

This is the file for the deployment this guide builds. The backend's `.env.example` lists every other setting with its default.

```
# 3. AlloyDB. PGPASSWORD is added below, from the shell.
DATABASE_URL=postgresql://agentfactory@ALLOYDB_IP:5432/agentfactory?sslmode=require
DB_POOL_SIZE=20
AUTO_MIGRATE=0

# 4.7 Modes: worker threads beside the API (0 when workers run as their own Deployment)
WORKERS=2

# 10. Sign-in, through IAP on the console's Cloud Run service
IAP_AUDIENCE=/projects/PROJECT_NUMBER/locations/GCP_REGION/services/agentfactory-console
IAP_ROLE_MAP={"first.admin@example.com":"platform_admin","second.admin@example.com":"platform_admin","auditor@example.com":"auditor"}
IAP_SIGNOUT_URL=/?gcp-iap-mode=CLEAR_LOGIN_COOKIE
PUBLIC_ORIGIN=https://agentfactory-console-PROJECT_NUMBER.GCP_REGION.run.app

# 11. The machines' route
PUBLIC_API_URL=https://api.example.com

# 6. Vertex AI
GCP_PROJECT=PROJECT_ID
REGION=global
VERTEX_PUBLISHERS=google
EMBEDDING_ENDPOINT=vertex
EMBEDDING_MODEL=google/EMBEDDING_MODEL_ID

# 7. Model Armor
SCREENER=model_armor
MODEL_ARMOR_TEMPLATE=projects/PROJECT_ID/locations/GCP_REGION/templates/agentfactory
SCREENER_UNAVAILABLE=block

# 8. The vault: Secret Manager (or SECRETS=local with VAULT_KEY)
SECRETS=secret-manager

# 9. Cloud Storage
FILES_BUCKET=PROJECT_ID-agentfactory-files

# 4.8 The sandbox (SANDBOX, SANDBOX_NAMESPACE and SANDBOX_SERVICE_ACCOUNT are set in backend.yaml itself)
SANDBOX_IMAGE=GCP_REGION-docker.pkg.dev/PROJECT_ID/agentfactory/python@sha256:DIGEST
SANDBOX_RUNTIME_CLASS=gvisor
# DENIED_ADDRESS_RANGES=34.118.224.0/20

# 13. The four use cases' workloads
# WORKLOAD_URLS={"sast":"https://sast.example.com","pentest":"https://pentest.example.com","firewall":"https://firewall.example.com","threat_hunt":"https://hunt.example.com"}
# WORKLOAD_AGENTS={"threat_hunt":"AGENT_ID"}

# 11. Agent-to-agent peers, if any
# A2A_PUBLIC_URL=https://api.example.com
# A2A_SIGNING_KEY_NAME=a2a-signing-key
```

Add the database password from 3.2 to the file once, from the shell, then make the Secret:

```sh
printf '\nPGPASSWORD=%s\n' "$AGENTFACTORY_DB_PASSWORD" >> settings.env
kubectl create secret generic agentfactory-settings --namespace agentfactory --from-env-file=settings.env
```

- **Every value is checked when the process starts.** A value that cannot be used stops the process, and the log names
  the setting and the reason. `kubectl logs` shows it.
- **Changing a setting** means re-creating the Secret and restarting the pods. Pods read their environment only when
  they start:

  ```sh
  kubectl create secret generic agentfactory-settings --namespace agentfactory --from-env-file=settings.env \
    --dry-run=client -o yaml | kubectl apply -f -
  kubectl rollout restart deployment/agentfactory --namespace agentfactory
  ```

- **Values set in `backend.yaml` win.** The manifest sets `SANDBOX`, `SANDBOX_NAMESPACE` and `SANDBOX_SERVICE_ACCOUNT`
  under `env`, and Kubernetes gives `env` precedence over `envFrom`, so the same names in the Secret are ignored.
- The Secret holds `PGPASSWORD` (and `VAULT_KEY` with `SECRETS=local`). Restrict who can read Secrets in the
  namespace, and keep `settings.env` where only you can read it.
- Resource requests and limits are not set in `backend.yaml`. Size them to your load.

### 4.6 The migrate Job

With `AUTO_MIGRATE=0`, run the schema step before the first start and before every upgrade:

```yaml
# migrate-job.yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: agentfactory-migrate
  namespace: agentfactory
spec:
  backoffLimit: 0
  template:
    spec:
      serviceAccountName: agentfactory
      restartPolicy: Never
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: migrate
          image: BACKEND_IMAGE
          args: ["migrate"]
          envFrom:
            - secretRef:
                name: agentfactory-settings
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

```sh
kubectl delete job agentfactory-migrate --namespace agentfactory --ignore-not-found
kubectl apply -f migrate-job.yaml
kubectl wait --for=condition=complete job/agentfactory-migrate --namespace agentfactory --timeout=600s
kubectl logs job/agentfactory-migrate --namespace agentfactory      # "applied: …" or "applied: nothing new"
```

If the Job fails at `0003_knowledge.sql` with `permission denied to create extension "vector"`, 3.2 was not done in the
`agentfactory` database.

On the first install, start the backend once the Job has completed:

```sh
kubectl scale deployment/agentfactory --replicas=1 --namespace agentfactory
kubectl rollout status deployment/agentfactory --namespace agentfactory
```

### 4.7 api and worker modes

| Mode | What it does |
|---|---|
| `api` | The HTTP service on `PORT` (8080 in the image), plus `WORKERS` worker threads (default 2). `backend.yaml` runs it this way, so one Deployment is a whole deployment. |
| `worker` | Takes runs from the queue in its own process, `WORKER_THREADS` threads (default 4) when `WORKERS=0`. No HTTP port. |

Scheduled chores run only in processes that run workers. They are: gate deadlines, knowledge refresh, connector sync,
the retention sweep, log forwarding, scheduled runs, evaluations and policy changes. A process with `WORKERS=0` runs
none of them.

To run workers apart, set `WORKERS=0` in `settings.env`, re-create the Secret, and add this Deployment. It uses the
same service account, because the sandbox's RoleBinding names it, and the same sandbox settings:

```yaml
# worker.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentfactory-worker
  namespace: agentfactory
  labels:
    app.kubernetes.io/part-of: agentfactory
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: agentfactory-worker
  template:
    metadata:
      labels:
        app.kubernetes.io/name: agentfactory-worker
    spec:
      serviceAccountName: agentfactory
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
        runAsGroup: 10001
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: worker
          image: BACKEND_IMAGE
          args: ["worker"]
          envFrom:
            - secretRef:
                name: agentfactory-settings
          env:
            - name: SANDBOX
              value: kubernetes
            - name: SANDBOX_NAMESPACE
              value: agentfactory-sandbox
            - name: SANDBOX_SERVICE_ACCOUNT
              value: agentfactory-sandbox
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
          volumeMounts:
            - name: tmp
              mountPath: /tmp
      volumes:
        - name: tmp
          emptyDir: {}
```

The label differs from the API's, so the Service never sends requests to a worker. A worker has no HTTP endpoint, so
it has no probes. Its health is its heartbeat, which preflight's `workers` check reads (section 13).

### 4.8 The sandbox: namespace, deny-all policy, service account, gVisor

```sh
kubectl apply -f deploy/k8s/sandbox.yaml
```

`sandbox.yaml` makes the following:

- the namespace `agentfactory-sandbox`, with Pod Security "restricted" enforced;
- the service account `agentfactory-sandbox`: no role, no Google identity, and its token is never mounted;
- the NetworkPolicy `agentfactory-sandbox-deny`: no ingress and no egress for Pods labelled
  `agentfactory.io/sandbox: job`;
- a Role and RoleBinding that are the backend's only Kubernetes permissions, in that namespace only.

Grant nothing to `agentfactory-sandbox` in IAM, directly or through an annotation.

The settings:

| Setting | Value here | Meaning (default) |
|---|---|---|
| `SANDBOX` | `kubernetes` (in `backend.yaml`) | The isolator. Unset, every request to run code is refused. |
| `SANDBOX_NAMESPACE` | `agentfactory-sandbox` (in `backend.yaml`) | Where Jobs are created. Required with `kubernetes`. Never a shared namespace (`default`, `kube-*`), and never the backend's own. |
| `SANDBOX_SERVICE_ACCOUNT` | `agentfactory-sandbox` (in `backend.yaml`) | What the Jobs run as (default `agentfactory-sandbox`). Never `default`. |
| `SANDBOX_RUNTIME_CLASS` | `gvisor` | The RuntimeClass of the Jobs' Pods (default: none, the node's own runtime). |
| `SANDBOX_NODE_SELECTOR` | not set | JSON of node labels, for a dedicated pool that is not GKE Sandbox. With `gvisor`, GKE places the Pod itself. The isolator sets no tolerations. |
| `SANDBOX_IMAGE` | the mirrored digest (4.3) | The image both languages run in (default `python:3.12-slim`). |
| `SANDBOX_PUBLIC_PROBE` | default | A public IP and port each Job must fail to reach before its code runs (default `8.8.8.8:53`). |
| `SANDBOX_TIMEOUT_SECONDS`, `SANDBOX_MAX_OUTPUT_BYTES`, `SANDBOX_MAX_INPUT_BYTES` | defaults | 30 s per program; 65536 bytes kept per stream; 524288 bytes handed in. |

Before every Job, the isolator (`agentfactory/guard/isolation.py`) checks the following and refuses with the reason when
one fails:

- the namespace rules above;
- the deny-all policy exists, and no other NetworkPolicy in the namespace opens the Job's Pod;
- the Jobs' service account exists and has no `iam.gke.io/gcp-service-account` annotation;
- the inputs the cluster holds match what was handed in, while the Job is still suspended.

Then, inside the Pod and before the program, it checks:

- the mounted inputs' digest;
- that the Pod reaches none of: the Kubernetes API, the metadata server (`169.254.169.254:80`,
  `169.254.169.252:988`) and `SANDBOX_PUBLIC_PROBE`.

That last check proves the network is closed. Without NetworkPolicy enforcement (no Dataplane V2), the probes reach
those addresses, and **every Job is refused after 45 seconds**.

The sandbox does not enforce a process limit (the kubelet's `podPidsLimit`) or `noexec` on `/tmp`; set the first on
the sandbox node pool if you need it. Preflight only reports whether `SANDBOX` is set. It runs no Job, so run one on
the first day (section 15).

---

## 5. Service accounts and IAM

Every role below comes from a call the code makes. Grant at the narrowest level shown.

### 5.1 The backend: `BACKEND_GSA`

| Role | Granted on | Why (the call in the code) | Needed |
|---|---|---|---|
| `roles/iam.workloadIdentityUser` for `serviceAccount:PROJECT_ID.svc.id.goog[agentfactory/agentfactory]` | `BACKEND_GSA` itself | the Kubernetes account acts as this account (4.4) | always |
| `roles/aiplatform.user` | the project | chat completions on `…/endpoints/openapi`; embeddings with `…/publishers/P/models/M:predict`; the publisher model lists and the project's endpoint and model lists the Vertex panel reads (`providers/endpoints.py`, `providers/embeddings.py`, `api/routes/modelsettings.py`) | with Vertex AI |
| `roles/modelarmor.user` | the template's project | `templates/T:sanitizeUserPrompt` and `:sanitizeModelResponse` (`guard/screening.py`) | with `SCREENER=model_armor` |
| `roles/modelarmor.viewer` | the template's project | `GET templates/T`, the screener's health check, which preflight runs. `modelarmor.user` does not hold `templates.get` ([roles](https://docs.cloud.google.com/iam/docs/roles-permissions/modelarmor)). | with `SCREENER=model_armor` |
| `roles/secretmanager.editor` | the project | create, patch (annotations), delete and list secrets; add versions (`guard/vault.py`) | with `SECRETS=secret-manager` |
| `roles/secretmanager.secretAccessor` | the project | `versions/latest:access`. `editor` does not hold it ([roles](https://docs.cloud.google.com/iam/docs/roles-permissions/secretmanager)). | with `SECRETS=secret-manager` |
| `roles/storage.objectUser` | the files bucket | upload, read, delete and read the metadata of objects (`storage.py`) | always |
| `roles/storage.objectViewer` | each knowledge bucket | `objects.list` and `objects.get` (`knowledge/connectors/bucket.py`) | with bucket connectors |
| `roles/securitycenter.findingsViewer` | the project | `v2/projects/P/sources/-/locations/L/findings` (`assurance/findings.py`) | with findings (section 12) |
| a custom role with `iap.webServices.getIamPolicy`, `iap.webTypes.getIamPolicy` and `iap.web.getIamPolicy` | the project | the IAP access list on the identity pages (`identity/iap_access.py`). Of the predefined roles only `roles/iap.admin` holds them, and it can also change the list ([roles](https://docs.cloud.google.com/iam/docs/roles-permissions/iap)). | optional |

The backend needs no role for Cloud Trace or Cloud Logging. It sends OTLP to a collector, which holds those roles
(section 12). It also needs no AlloyDB role (3.3).

`preflight` and the backend's `.env.example` name `roles/storage.objectAdmin` for the files bucket. That role works too.
`roles/storage.objectUser` is narrower: it lacks object IAM and retention permissions, which the backend never uses
([storage roles](https://docs.cloud.google.com/iam/docs/roles-permissions/storage)).

```sh
for ROLE in roles/aiplatform.user roles/modelarmor.user roles/modelarmor.viewer; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$BACKEND_GSA --role=$ROLE --condition=None
done

# With SECRETS=secret-manager:
for ROLE in roles/secretmanager.editor roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$BACKEND_GSA --role=$ROLE --condition=None
done

# With Security Command Center findings:
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$BACKEND_GSA \
  --role=roles/securitycenter.findingsViewer --condition=None

# The IAP access list (optional):
gcloud iam roles create agentfactoryIapReader --project=$PROJECT_ID \
    --title="Saros IAP access reader" --description="Reads IAP access lists" \
    --permissions="iap.webServices.getIamPolicy,iap.webTypes.getIamPolicy,iap.web.getIamPolicy" --stage=GA
gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$BACKEND_GSA \
  --role=projects/$PROJECT_ID/roles/agentfactoryIapReader --condition=None
```

The bucket grants are in section 9. Sources:
[custom roles](https://docs.cloud.google.com/iam/docs/creating-custom-roles) (whether these three permissions are allowed in
a custom role: `gcloud iam list-testable-permissions` shows each one's `customRolesSupportLevel`),
[Secret Manager access control](https://docs.cloud.google.com/secret-manager/docs/access-control),
[Security Command Center roles](https://docs.cloud.google.com/security-command-center/docs/access-control-project).

### 5.2 The sandbox: `agentfactory-sandbox`

No IAM role, no annotation, no Workload Identity binding. The isolator refuses to run a Job if the account carries the
annotation. In Kubernetes it holds no Role; the Role in `sandbox.yaml` is bound to the backend's account, not this one.

### 5.3 The console: `CONSOLE_GSA`

```sh
gcloud iam service-accounts create agentfactory-console --display-name="Saros console"
```

No roles. The console calls no Google API. The person or pipeline that deploys it needs `roles/run.developer`,
`roles/iam.serviceAccountUser` on `CONSOLE_GSA` and `roles/artifactregistry.reader`
([source](https://docs.cloud.google.com/run/docs/deploying)). IAP's own service agent gets `roles/run.invoker` on the
console service (section 10).

### 5.4 People

| Who | Google role | Where |
|---|---|---|
| everyone who may open the console | `roles/iap.httpsResourceAccessor` | the console's IAP resource (section 10) |
| whoever enables partner models in Model Garden | `roles/consumerprocurement.entitlementManager` | the project ([source](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/use-partner-models)) |
| whoever creates the Model Armor template | `roles/modelarmor.admin` | the project |

What a person may do inside the console comes from `IAP_ROLE_MAP`, not from Google roles (section 10).

---

## 6. Vertex AI models

### 6.1 How the backend reaches Vertex AI

The Vertex AI endpoint exists only while the backend has a Google identity **and** a project **and** a location
(`providers/endpoints.py`). Its base address is:

```
{host}/v1/projects/{GCP_PROJECT}/locations/{REGION}/endpoints/openapi

host = VERTEX_ENDPOINT if set
     = https://aiplatform.googleapis.com          when REGION is global
     = https://{REGION}-aiplatform.googleapis.com otherwise
```

From that base, the backend makes these calls:

- **Chat:** `POST {base}/chat/completions`. The model is written `publisher/model`, for example `google/MODEL_ID`. The
  body may carry `tools`, `response_format` (`json_schema`; if refused, it asks once more with `json_object`),
  `temperature` and `max_completion_tokens`.
- **Embeddings:** `POST {host}/v1/projects/{GCP_PROJECT}/locations/{REGION}/publishers/{publisher}/models/{model}:predict`,
  Vertex AI's own embedding call. Embeddings are not sent to the OpenAI-compatible endpoint, because Google documents
  chat completions only there.
- **Model lists:** `GET {host}/v1beta1/publishers/{publisher}/models` for each `VERTEX_PUBLISHERS` entry, up to 6 pages
  of 200. The project's own `…/endpoints` and `…/models` are listed too.

| Setting | Set it to | Meaning (default) |
|---|---|---|
| `GCP_PROJECT` | `PROJECT_ID` | The project in every Vertex AI, Secret Manager and Security Command Center address (default: the metadata server's project; Secret Manager and findings read only this setting). |
| `REGION` | `VERTEX_LOCATION` | The Vertex AI location: `global`, `us`, `eu` or a region (default: from the metadata server; on GKE, the node's zone without its last part). |
| `VERTEX_ENDPOINT` | see below | The host, in place of the one worked out from `REGION`. https only (plain http only to the pod's own loopback). |
| `VERTEX_PUBLISHERS` | `google` | Whose model lists are read (default `google,anthropic,meta,mistralai`). |
| `EMBEDDING_MODEL` | `google/EMBEDDING_MODEL_ID` | The embedding model; a bare name means a Google model (default: none; knowledge search is then by wording only). |
| `EMBEDDING_ENDPOINT` | `vertex` | Which endpoint embeds: `vertex` or `default` (`MODEL_ENDPOINT`). Default: the first endpoint the settings name, which is Vertex AI when it is present. |
| `EMBEDDING_DIMENSIONS` | `0` | The width to ask for (`outputDimensionality`); 0 is the model's own. |
| `EVAL_JUDGE_MODEL` | not set | The model a judge check asks (default: the deployment's default model). |
| `MODEL_ENDPOINT`, `MODEL_API_KEY`, `MODEL_AUTH`, `MODEL_NAMES`, `MODEL_ENDPOINT_LABEL` | not set | A second, OpenAI-compatible endpoint, if you have one. The backend's `.env.example` describes each. |
| `GCP_TOKEN`, `GCP_METADATA_HOST`, `GCP_CREDENTIALS_FILE`, `GOOGLE_APPLICATION_CREDENTIALS` | never on GKE | Development and stand-ins only. On GKE the metadata server gives the identity. |

**Choosing the location.**

- `REGION=global` is the only location for which the backend builds the address in exactly the v1 form Google
  documents ([OpenAI compatibility](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/overview),
  [auth and credentials](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/migrate/openai/auth-and-credentials)).
  Google warns: "Don't use the global endpoint if you have ML processing requirements"
  ([locations](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations)).
- For the multi-regions, set both `REGION` and `VERTEX_ENDPOINT`: `REGION=eu` with
  `VERTEX_ENDPOINT=https://aiplatform.eu.rep.googleapis.com`, or `us` with `https://aiplatform.us.rep.googleapis.com`.
  Without `VERTEX_ENDPOINT`, the backend would build `https://eu-aiplatform.googleapis.com`, which is not Google's
  multi-region host.
- A single region (for example `europe-west4`) gives `https://europe-west4-aiplatform.googleapis.com`. Google shows the
  regional OpenAI-compatible address only under `v1beta1`.
- Model availability differs by model and location. Some current Gemini models are served on `global`, `us` and `eu`
  only. Check each model's page before you choose. Chat, embeddings and the model lists all use the one location
  `REGION` names, so the embedding model must be served there too.

**Publishers.** Chat calls go to `…/endpoints/openapi/chat/completions`, where Google documents Gemini, except Claude.
A Claude model (`anthropic/claude-opus-5-5`, `anthropic/claude-sonnet-5-5`) is served through the Claude connector:
`…/publishers/anthropic/models/{model}:rawPredict` with Anthropic's Messages API, at the same host and location, as
the same identity ([Claude on Vertex AI](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/use-claude)).
It answers 404 until Claude is enabled for the project: open the model's card in Model Garden and click **Enable**
(this needs the Consumer Procurement Entitlement Manager role; the backend's identity needs `aiplatform.endpoints.predict`,
which Vertex AI User holds). Claude Opus 5.5 and Sonnet 5.5 are served on `global` and the `us` and `eu` multi-regions,
not on a single region. Add `anthropic` to `VERTEX_PUBLISHERS` to list them.

Other publishers are called in the form Google documents for each (`vertex_form` in `providers/endpoints.py`):
the open models served as a service (`openai/gpt-oss-120b-maas`, `deepseek-ai/…-maas`, `zai-org/…-maas`,
`meta/llama-4-…-maas`) and xAI (`xai/grok-4.7`) on the OpenAI-compatible endpoint; Mistral
(`mistralai/mistral-medium-3`) through `rawPredict`, at `us-central1` or `europe-west4` only; Muse models from Meta
(`meta/muse-wonder-1.0`, `global` only) and OpenAI's partner models (`openai/gpt-6.1-sol`, Private Preview) through
their Responses API. Each must be enabled on its Model Garden card first. None of these has been called on Google
Cloud from this backend, only against a stand-in: add a publisher to `VERTEX_PUBLISHERS` after one of its models has
answered a run.

### 6.2 Offering models and setting their prices

A fresh deployment offers no model, and no run starts until a platform admin offers one. In the console, open
**Configuration → Models** (`/configuration?tab=models`):

1. **Detected on Google Vertex AI** lists what the backend's identity can see. Being listed means neither offered nor
   called.
2. Under **Models**, tick each model teams may pick. Give it its tier (`small`, `medium` or `large`) and its price in
   USD per million tokens, in and out. Choose the default model and a default for each tier. Prices are yours to enter;
   no price is read from Google.
3. A model with no price shows "no price set", and its calls have no cost. A run that a period budget applies to
   (section 12) may not call an unpriced model at all, because the budget could not be kept.

Every change is checked before it is stored and is written to the audit trail.

### 6.3 Data-class clearance and fallbacks

Data classes, least sensitive first, are `public`, `internal`, `confidential` and `restricted` (`agentfactory/modelconfig.py`).

- A model may be sent exactly the classes in its clearance. A model offered without one is cleared for `public` and
  `internal` only. Confidential and restricted data need a clearance someone gave on purpose.
- When a call carries a class that its chosen model is not cleared for, the backend walks that model's fallbacks, in
  order, to the first one that is cleared. If none is, the call is not made and the reason is recorded.
- A fallback must be another offered model. A model cannot fall back to itself, and fallbacks cannot form a cycle.
- A run's class starts at `RUN_DEFAULT_DATA_CLASS` (default `internal`) when nothing else gives it one, and rises with
  what the run reads.

Clear a model for `confidential` or `restricted` only after your own review of where that model runs: its location,
and whether it is a Google or a partner model.

### 6.4 The embedding model against the knowledge store

The vector column has no fixed width (`migrations/0003_knowledge.sql`), so any model and width can be stored. Each
passage records the model and width its vector was made with. A search reads only the passages of the model and width
configured now. Search is exact; there is no approximate index.

- Changing `EMBEDDING_MODEL` or `EMBEDDING_DIMENSIONS` leaves the passages already admitted findable by wording only.
  Each store must then be re-embedded: on the Knowledge page (`/knowledge`), or with `POST /api/knowledge/reembed`
  (configure permission).
- Default widths, per Google's
  [embeddings page](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/embeddings/get-text-embeddings):
  `gemini-embedding-001` is 3072 wide and takes one text per request; the backend sends one at a time.
  `text-embedding-005` and `text-multilingual-embedding-002` are 768 wide; the backend sends five per request.
- A narrower `EMBEDDING_DIMENSIONS` makes exact search cheaper. Choose it before the first document is admitted.

---

## 7. Model Armor

### 7.1 Creating the template

```sh
gcloud config set api_endpoint_overrides/modelarmor "https://modelarmor.$GCP_REGION.rep.googleapis.com/"

gcloud model-armor templates create agentfactory --project=$PROJECT_ID --location=$GCP_REGION \
  --rai-settings-filters='[{ "filterType": "HATE_SPEECH", "confidenceLevel": "MEDIUM_AND_ABOVE" },{ "filterType": "HARASSMENT", "confidenceLevel": "MEDIUM_AND_ABOVE" },{ "filterType": "SEXUALLY_EXPLICIT", "confidenceLevel": "MEDIUM_AND_ABOVE" }]' \
  --basic-config-filter-enforcement=enabled \
  --pi-and-jailbreak-filter-settings-enforcement=enabled \
  --pi-and-jailbreak-filter-settings-confidence-level=HIGH \
  --malicious-uri-filter-settings-enforcement=enabled

gcloud model-armor templates describe agentfactory --project=$PROJECT_ID --location=$GCP_REGION
```

Source: [manage templates](https://docs.cloud.google.com/model-armor/manage-templates). Choose the filters and confidence
levels yourself. Google's example also sets template metadata, but do not set
`--template-metadata-ignore-partial-invocation-failures`: the backend treats any answer other than a complete one as an
outage (7.3), so partial results would only turn into outage verdicts.

### 7.2 Settings

| Setting | Value here | Meaning (default) |
|---|---|---|
| `SCREENER` | `model_armor` | `platform` (the backend's own detectors, in process, the default) or `model_armor`. |
| `MODEL_ARMOR_TEMPLATE` | `projects/PROJECT_ID/locations/GCP_REGION/templates/agentfactory` | The full template name. Any other form stops the service at start. With `model_armor` and no template, every verdict is "screener unavailable" and preflight fails the screener. |
| `MODEL_ARMOR_ENDPOINT` | not set | Default `https://modelarmor.LOCATION.rep.googleapis.com`, with LOCATION taken from the template name. Set only to reach a stand-in. |
| `SCREENER_UNAVAILABLE` | `block` | What a question gets when the screener cannot answer: `block` (default) or `flag`. Outages only; it never weakens what a hit does. |
| `SCREENER_TIMEOUT_SECONDS` | `10` | How long one call may take. A network fault, 429 or 5xx is tried once more. |
| `SCREENER_PATTERNS` | optional | A JSON list of your own block patterns (`"re:…"` a regular expression, anything else a phrase). They are asked before Model Armor on every question. |

### 7.3 What is screened

From `guard/screening.py`:

| Question | When | Model Armor method | A filter match | A sensitive-data match |
|---|---|---|---|---|
| prompt | before text reaches a model | `sanitizeUserPrompt` | block | flag |
| tool result | before a tool's answer enters the run | `sanitizeUserPrompt` | block | flag |
| tool description | when a tool server's tools are read | `sanitizeUserPrompt` | block | flag |
| response | after a model writes | `sanitizeModelResponse` | block | block |
| sink arguments | before a tool that acts outside is called | `sanitizeModelResponse` | block | block |

- "Flag" records the verdict and lets the step go on. "Block" refuses the step. The control is recorded as
  `modelarmor.<question>.<filter>`.
- With `model_armor`, only your `SCREENER_PATTERNS` and Model Armor screen. The backend's own detectors (instruction
  override, jailbreak, credentials, hidden characters) run only with `SCREENER=platform`.
- Model Armor's answer counts only when it is complete: `invocationResult` is `SUCCESS`, every filter's
  `executionState` is `EXECUTION_SUCCESS`, and every match state is `MATCH_FOUND` or `NO_MATCH_FOUND`. Anything else is
  an outage verdict, `screener.unavailable`, which follows `SCREENER_UNAVAILABLE`. The same goes for a 4xx, a timeout,
  a missing identity or any other exception. With the default `block`, an outage stops the step.
- Google's limits ([quotas](https://docs.cloud.google.com/model-armor/quotas)): 65,536 tokens for the prompt-injection,
  jailbreak and responsible-AI filters; 0.5 MB for sensitive data; 1,200 requests per minute per project. Every model
  step makes at least two calls, and tool calls add more. A tool result larger than these limits has not been tried.

IAM: `roles/modelarmor.user` and `roles/modelarmor.viewer` (section 5).

---

## 8. Secret Manager

The vault holds the credentials that tool arguments and tool servers name as `${secret:NAME}`. They are read at the
moment of use and never shown. It also holds the A2A signing key when `A2A_SIGNING_KEY_NAME` names one. There are two
stores, chosen by `SECRETS`:

| `SECRETS` | Store | Needs |
|---|---|---|
| `local` (default) | the table `vault_secrets` in AlloyDB, AES-256-GCM, keyed by `VAULT_KEY` | `VAULT_KEY`: 32 random bytes as base64. Make one: `python -c 'import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())'`. Without a usable key, every vault read and write answers 503 naming it. |
| `secret-manager` | Google Secret Manager in `GCP_PROJECT` | `GCP_PROJECT` set; the two roles in section 5. `VAULT_KEY` is not used. |

How the `secret-manager` store keeps a credential (`guard/vault.py`):

- **Naming.** One secret per credential, with the id `agentfactory-vault-NAME`, the label `agentfactory=vault`, and the
  annotations `agentfactory-by` and `agentfactory-label`. The list reads only secrets with that label.
- **Writing.** Setting a value creates the secret (or patches its annotations, if it exists) and adds a version.
  Reading takes `versions/latest`. Removing a credential deletes the whole secret. Older versions are kept by Secret
  Manager until you destroy them.
- **Replication** is hard-coded to `automatic`. Google: "a secret with an automatic replication policy can only be
  created if resource creation in `global` is allowed"
  ([source](https://docs.cloud.google.com/secret-manager/docs/choosing-replication)). If your organization policy
  restricts resource locations, setting a credential fails, and the backend has no setting to choose user-managed
  replication.
- **Last use** is not recorded by this store. The console shows it as not built.

Preflight's `vault` check makes one list call with this store, and checks the key with `local` (section 13).

---

## 9. Cloud Storage

### 9.1 The files bucket: `FILES_BUCKET`

Uploaded datasets and documents are kept here. The database holds the record of each file, and the bucket holds its
bytes.

```sh
gcloud storage buckets create gs://$FILES_BUCKET --project=$PROJECT_ID --location=$GCP_REGION \
  --uniform-bucket-level-access
gcloud storage buckets update gs://$FILES_BUCKET --public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://$FILES_BUCKET \
  --member=serviceAccount:$BACKEND_GSA --role=roles/storage.objectUser
```

Sources: [create buckets](https://docs.cloud.google.com/storage/docs/creating-buckets),
[public access prevention](https://docs.cloud.google.com/storage/docs/using-public-access-prevention),
[bucket IAM](https://docs.cloud.google.com/storage/docs/access-control/using-iam-permissions).

The backend always calls `https://storage.googleapis.com`; for the files bucket that address is not a setting. Preflight's
`file storage` check writes, reads back and deletes a small object under `health/`.

### 9.2 The knowledge bucket connector

A connector ingests the documents under a bucket and prefix into a knowledge store. Bucket connectors are the only
kind (`knowledge/connectors/`).

- **Its rule** is what decides what it ingests and how it is held: the bucket, the prefix, the store it feeds, the
  data class and entitlement its documents carry, the file types and the size cap. The rule has a digest.
- **Admission.** The person who registered the connector, or last changed its rule, cannot admit it. Another person
  with the configure permission must, naming the digest they read. No setting turns this off. A change to the rule
  stops ingestion until the changed rule is admitted.
- **Sync.** Once admitted, the connector lists the bucket again every `KNOWLEDGE_CONNECTOR_SYNC_MINUTES` (default 15).
  Syncing is a chore, so it runs only where workers run. Each object is read at the generation that was listed.
- **The files bucket** is refused as a connector bucket.
- **Where.** Register and admit connectors on the Knowledge page (`/knowledge`).

Grant read access on each knowledge bucket:

```sh
gcloud storage buckets add-iam-policy-binding gs://KNOWLEDGE_BUCKET \
  --member=serviceAccount:$BACKEND_GSA --role=roles/storage.objectViewer
```

| Setting | Meaning (default) |
|---|---|
| `KNOWLEDGE_BUCKET_API` | The Cloud Storage JSON API up to `/storage/v1` (default `https://storage.googleapis.com`). https only, except to the pod's own loopback for a stand-in. Leave unset. |
| `KNOWLEDGE_CONNECTOR_SYNC_MINUTES` | How often each admitted connector is listed again (default 15). |
| `KNOWLEDGE_UPLOAD_MAX_BYTES` | The largest document, uploaded or synced (default 25000000). A connector's own size cap may be lower. |

---

## 10. The console on Cloud Run behind IAP

The console repository's `deploy/console/README.md` has the console's own details, and the table of what each sign-in
failure looks like.

### 10.1 The image: `NEXT_PUBLIC_ORIGIN` at build

`NEXT_PUBLIC_ORIGIN` is compiled into the pages, so it is a build argument. It must be the address people will open,
exactly: the `run.app` address from section 0, or your own domain. From the console repository's root:

```sh
gcloud builds submit . --config deploy/console/cloudbuild.yaml \
  --substitutions _IMAGE=$CONSOLE_IMAGE,_ORIGIN=https://$CONSOLE_SERVICE-$PROJECT_NUMBER.$GCP_REGION.run.app
```

The build downloads npm packages and fonts, so it needs outbound access. The running console needs none. If the
address changes, rebuild. A console built for another address refuses writes ("cross-origin writes are refused").

### 10.2 The backend's internal address: `BACKEND_ORIGIN`

Cloud Run cannot resolve the cluster's own names (`…svc.cluster.local`). Give the backend an internal passthrough
Network Load Balancer, on the reserved IP from 2.3, open only to the Cloud Run egress subnet:

```yaml
# console-route.yaml
apiVersion: v1
kind: Service
metadata:
  name: agentfactory-console-route
  namespace: agentfactory
  annotations:
    networking.gke.io/load-balancer-type: "Internal"
spec:
  type: LoadBalancer
  loadBalancerIP: BACKEND_ILB_IP
  loadBalancerSourceRanges:
    - 10.11.0.0/26          # the run-egress subnet
  selector:
    app.kubernetes.io/name: agentfactory
  ports:
    - name: http
      port: 80
      targetPort: http
```

```sh
kubectl apply -f console-route.yaml
```

For `loadBalancerSourceRanges`, "GKE sets the firewall rule's source parameter to the IP addresses in that list"
([source](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/service-load-balancer-parameters)). The Service
listens on **port 80**, so `BACKEND_ORIGIN=http://BACKEND_ILB_IP`, as the console's `deploy/console/env.cloudrun.yaml`
writes it.

This hop is plain HTTP inside the VPC. The IAP assertion travels on it, and only the backend can use it: it is signed
for this audience and carries an expiry the backend checks. If your policy requires TLS on this hop, the console accepts an https
`BACKEND_ORIGIN`. Node.js must trust the certificate, and that has not been tried.

### 10.3 Deploy with IAP and Direct VPC egress

```sh
gcloud run deploy $CONSOLE_SERVICE \
  --project=$PROJECT_ID --region=$GCP_REGION \
  --image=$CONSOLE_IMAGE \
  --service-account=$CONSOLE_GSA \
  --port=8080 \
  --set-env-vars=BACKEND_ORIGIN=http://$BACKEND_ILB_IP \
  --network=$NETWORK --subnet=run-egress --vpc-egress=private-ranges-only \
  --no-allow-unauthenticated \
  --iap

gcloud services identity create --service=iap.googleapis.com --project=$PROJECT_ID

gcloud run services add-iam-policy-binding $CONSOLE_SERVICE \
  --region=$GCP_REGION \
  --member=serviceAccount:service-$PROJECT_NUMBER@gcp-sa-iap.iam.gserviceaccount.com \
  --role=roles/run.invoker
```

Sources: [IAP for Cloud Run](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run) (generally
available), [enabling IAP for Cloud Run](https://docs.cloud.google.com/iap/docs/enabling-cloud-run),
[Direct VPC egress](https://docs.cloud.google.com/run/docs/configuring/vpc-direct-vpc). A Serverless VPC Access
connector (`--vpc-connector`) works in place of Direct VPC egress.

Google's notes:

- IAP goes on the Cloud Run service or on a load balancer in front of it, never both.
- IAP covers every way in, the `run.app` address included.
- The Google-managed OAuth client admits only users in your organization. Users outside it, or a project with no
  organization, need a custom OAuth client.

### 10.4 `IAP_AUDIENCE` on the backend

For IAP on Cloud Run, the audience is `/projects/PROJECT_NUMBER/locations/REGION/services/SERVICE_NAME`
([signed headers](https://docs.cloud.google.com/iap/docs/signed-headers-howto)). Use the project **number**, not its id.

The backend checks every request that carries `x-goog-iap-jwt-assertion`:

- ES256, with one of the keys published at `https://www.gstatic.com/iap/verify/public_key-jwk`, which it reads and keeps
  for an hour;
- issuer `https://cloud.google.com/iap`;
- this audience;
- `exp` and `iat`, with 30 seconds of skew.

The unsigned `x-goog-authenticated-user-*` headers are never read. An `Authorization` header next to the assertion is
ignored. `IAP_JWKS_URL` and `IAP_ISSUER` are for a mirror or a stand-in only.

### 10.5 The role map, sign-out and who may reach it

| Setting | Meaning |
|---|---|
| `IAP_ROLE_MAP` | JSON. Each key is an email address, a subject or `"@domain"`; each value is `platform_admin`, `auditor` or a list of them. A `"@domain"` key matches the Google Workspace domain IAP signs for the account (its `hd` claim), never the end of the address. An unknown role, or anything that is not such an object, stops the service at start. |
| `IAP_SIGNOUT_URL` | IAP's sign-out: the console's own address with `?gcp-iap-mode=CLEAR_LOGIN_COOKIE`, as a path (`/?gcp-iap-mode=CLEAR_LOGIN_COOKIE`) or in full ([source](https://docs.cloud.google.com/iap/docs/query-parameters-and-headers-howto)). Without it the console shows no "Sign out". |
| `PUBLIC_ORIGIN` | The console's address, the same as `NEXT_PUBLIC_ORIGIN`. Links to console pages start with it, and the MCP server and the attached agents' broker accept it as a browser origin. Without it, links are paths and preflight warns. |
| `TEAM_DOMAINS` | Optional JSON, email domain to team, for people nobody has given a team. |

The roles are defined in `agentfactory/identity/roles.py`:

- `platform_admin`: every screen and every action.
- `auditor`: reads every screen, the identity pages and the audit trail included, and changes nothing.

Anyone else IAP lets through holds no role and no permission. Name **at least two** platform admins. A version is
deployed only after a platform admin who did not save it has reviewed it, connectors and other approvals need a second
person, and no setting turns this off.

Who may reach the console is decided twice. IAP decides who reaches it at all; grant `roles/iap.httpsResourceAccessor`
on the console, preferably to groups:

```sh
gcloud iap web add-iam-policy-binding \
  --member=group:GROUP@example.com \
  --role=roles/iap.httpsResourceAccessor \
  --region=$GCP_REGION \
  --resource-type=cloud-run \
  --service=$CONSOLE_SERVICE
```

The role map then decides what each person may do. If you granted the backend the custom IAP reader role (section 5),
the identity pages show both lists side by side: who IAP lets through, and the role each one holds here.

---

## 11. The machine route

### 11.1 The doors and their authentication

Machines reach the backend at `PUBLIC_API_URL`, outside IAP. On that route, each door's own authentication is the only
gate (`deploy/README.md`). A request on it cannot act as a person: if it carries an IAP assertion, the backend verifies
it like any other. An address meant only for people refuses a key or a token, whatever the key carries.

| Path prefix | Door | Authentication |
|---|---|---|
| `/api/gateway/v1` | the model gateway for registered applications | the application's key |
| `/api/sdk` | attached agents' SDK run doors | the attached agent's key, valid once a second person has approved the attachment |
| `/api/a2a` | the A2A tasks door, its card and key set; attached agents' gateway (`/api/a2a/gateway/v1`) and tool broker (`/api/a2a/mcp/AGENT`) | tasks: an HTTP Message Signature made with the key of a peer that a second person approved. Card and key set: none. Attached agents: their key |
| `/api/trigger` | starting runs | an API key (minted under Configuration → Access), or a token from a workload issuer a platform admin registered |
| `/api/webhooks` | signed webhooks | a Standard Webhooks signature made with the secret the trigger names in the vault, or an API key |
| `/api/mcp/server` | the platform's own MCP server | an API key or a workload token |
| `/api/runs` | runs, for scripts | an API key or a workload token (only the run addresses open to keys accept one) |
| `/api/explore` | the estate explorer's entries, for scripts | an API key or a workload token |
| `/.well-known/agent-card.json`, `/.well-known/agent.json` | the A2A agent card at the root | none: a public document, as A2A discovery expects |

Expose only the prefixes you use. Adding agents is not part of this build: `POST /api/agents` answers only a person,
on the console's route, and no console screen adds an agent.

### 11.2 An internal Application Load Balancer through GKE Gateway, with TLS

The certificate is a Google-managed regional certificate with DNS authorization. Google confirms it works with the
regional internal Application Load Balancer. The authorization's CNAME record must be added to the domain's **public**
DNS, even when `API_HOST` itself resolves only privately.

```sh
gcloud certificate-manager dns-authorizations create agentfactory-api --domain="$API_HOST" --location="$GCP_REGION"
gcloud certificate-manager dns-authorizations describe agentfactory-api --location="$GCP_REGION"
#   add the CNAME record shown under dnsResourceRecord to the domain's public DNS
gcloud certificate-manager certificates create agentfactory-api --domains="$API_HOST" \
  --dns-authorizations="agentfactory-api" --location=$GCP_REGION
```

Source: [regional Google-managed certificates](https://docs.cloud.google.com/certificate-manager/docs/deploy-google-managed-regional).
A certificate from your own authority, uploaded to Certificate Manager, works the same way, but every caller must then
trust that authority.

```yaml
# machine-route.yaml
kind: Gateway
apiVersion: gateway.networking.k8s.io/v1
metadata:
  name: agentfactory-machines
  namespace: agentfactory
spec:
  gatewayClassName: gke-l7-rilb
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        options:
          networking.gke.io/cert-manager-certs: agentfactory-api
      allowedRoutes:
        kinds:
          - kind: HTTPRoute
---
kind: HTTPRoute
apiVersion: gateway.networking.k8s.io/v1
metadata:
  name: agentfactory-machine-doors
  namespace: agentfactory
spec:
  parentRefs:
    - name: agentfactory-machines
  hostnames:
    - api.example.com
  rules:
    - matches:
        - path: {type: PathPrefix, value: /api/gateway/v1}
        - path: {type: PathPrefix, value: /api/sdk}
        - path: {type: PathPrefix, value: /api/a2a}
        - path: {type: PathPrefix, value: /api/trigger}
        - path: {type: PathPrefix, value: /api/webhooks}
        - path: {type: PathPrefix, value: /api/mcp/server}
        - path: {type: PathPrefix, value: /api/runs}
        - path: {type: PathPrefix, value: /api/explore}
        - path: {type: Exact, value: /.well-known/agent-card.json}
        - path: {type: Exact, value: /.well-known/agent.json}
      backendRefs:
        - name: agentfactory
          port: 80
---
# The load balancer checks "/" unless told otherwise; the backend answers its health on /healthz, on the
# container's port 8080 (a port left out defaults to 80, which nothing listens on).
apiVersion: networking.gke.io/v1
kind: HealthCheckPolicy
metadata:
  name: agentfactory-health
  namespace: agentfactory
spec:
  default:
    config:
      type: HTTP
      httpHealthCheck:
        portSpecification: USE_FIXED_PORT
        port: 8080
        requestPath: /healthz
  targetRef:
    group: ""
    kind: Service
    name: agentfactory
---
# The backend timeout defaults to 30 seconds; a model call through the gateway may take up to 180.
apiVersion: networking.gke.io/v1
kind: GCPBackendPolicy
metadata:
  name: agentfactory-timeout
  namespace: agentfactory
spec:
  default:
    timeoutSec: 300
  targetRef:
    group: ""
    kind: Service
    name: agentfactory
```

```sh
kubectl apply -f machine-route.yaml
kubectl get gateway agentfactory-machines --namespace agentfactory -o jsonpath='{.status.addresses[0].value}'
```

Sources:
[deploying Gateways](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/deploying-gateways),
[securing a Gateway](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/secure-gateway),
[Gateway policies](https://docs.cloud.google.com/kubernetes-engine/docs/how-to/configure-gateway-resources).
Replace `api.example.com` in the HTTPRoute with `API_HOST`.

Point `API_HOST` at the Gateway's address in a private zone visible to the networks your machines call from. Make the
zone for the one host name, with the record at its apex. A private zone for the whole domain would answer for every
name under it inside the VPC, and hide your other hosts there.

```sh
gcloud dns managed-zones create agentfactory-api --description="Saros machine route" \
  --dns-name=$API_HOST. --networks=$NETWORK --visibility=private
gcloud dns record-sets create $API_HOST. --zone=agentfactory-api --type=A --ttl=300 --rrdatas=GATEWAY_IP
```

Sources: [zones](https://docs.cloud.google.com/dns/docs/zones), [records](https://docs.cloud.google.com/dns/docs/records).

**External callers.** If peers or SaaS webhooks call from the internet, use `gke-l7-regional-external-managed` or
`gke-l7-global-external-managed` instead, with a public certificate. Put your own edge protection in front of it;
this guide does not cover that.

`PUBLIC_API_URL` is the origin: `https://` plus `API_HOST`, nothing after. The console prints every machine address from
it: the gateway and its code samples, the SDK and broker addresses, the MCP endpoint, and the trigger and webhook
addresses. The backend uses it in its own answers. Without it, the console prints no machine address and says so,
and preflight fails.

### 11.3 A2A: `A2A_PUBLIC_URL` and the signing key

| Setting | Meaning |
|---|---|
| `A2A_PUBLIC_URL` | The https origin peers reach this platform at, nothing after the host. Requests are signed for this authority, and the backend checks a request's `@authority` against it, never against the Host header. It may be the same as `PUBLIC_API_URL`. Unset, the agent card answers 503. |
| `A2A_SIGNING_KEY` | The platform's private key: a P-256 EC private JWK on one line. It signs the card, every request to a peer and every answer of the tasks door. |
| `A2A_SIGNING_KEY_NAME` | The vault name of a credential that holds that same JWK, in place of `A2A_SIGNING_KEY`. Set one of the two, never both. |

Make a key with the backend image:

```sh
docker run --rm --entrypoint python $BACKEND_IMAGE -c \
  "from cryptography.hazmat.primitives.asymmetric import ec; import jwt; print(jwt.algorithms.ECAlgorithm.to_jwk(ec.generate_private_key(ec.SECP256R1())))"
```

Keep it in the vault:

1. A platform admin saves the printed line as a credential named, for example, `a2a-signing-key` under
   **Configuration → Access → Credentials**. With `SECRETS=secret-manager` this becomes the secret
   `agentfactory-vault-a2a-signing-key`.
2. Set `A2A_SIGNING_KEY_NAME=a2a-signing-key` and restart (4.5).

A key that cannot be parsed stops the service at start. A peer is trusted only after a second person approves it.

---

## 12. Optional integrations

### 12.1 Security Command Center findings

The backend reads the project's findings with
`GET https://securitycenter.googleapis.com/v2/projects/GCP_PROJECT/sources/-/locations/LOCATION/findings`, newest
first ([reference](https://docs.cloud.google.com/security-command-center/docs/reference/rest/v2/projects.sources.locations.findings/list)).
They show on the Control page (`/control`). When they cannot be read, the page shows the reason; it never shows an empty
list in its place.

| Setting | Meaning (default) |
|---|---|
| `GCP_PROJECT` | Required. Without it the findings answer 503. |
| `SECURITY_FINDINGS_LOCATION` | `global` (default); with data residency, `eu`, `us` or `sa` ([source](https://docs.cloud.google.com/security-command-center/docs/how-to-api-list-findings)). |
| `SECURITY_FINDINGS_FILTER` | The API's filter (default `state="ACTIVE"`). |
| `SECURITY_FINDINGS_ENDPOINT` | For a stand-in only. Leave unset. |

Role: `roles/securitycenter.findingsViewer` on the project. Google says viewing *all* findings needs
`roles/securitycenter.adminViewer`. Security Command Center must be active for the project.

### 12.2 Telemetry to Cloud Trace and Cloud Logging, through an OpenTelemetry collector

The backend sends OTLP over HTTP with JSON bodies: traces to `OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces`, logs to
`OTEL_EXPORTER_OTLP_ENDPOINT/v1/logs`. Exactly what is sent:

- **Traces.** One run tree at a time, only when a person with the configure permission calls
  `POST /api/observability/export` with `{"run": "RUN_ID"}`. No console screen makes that call, and nothing sends
  traces on its own. A run's trace can also be downloaded as OTLP JSON (`GET /api/observability/export?run=RUN_ID`).
- **Logs.** The audit trail, every row after the last one sent, when `LOG_FORWARD_TO=otlp`. This is a chore every 30
  seconds, so it runs only where workers run.

Google's collector for GKE ([install](https://docs.cloud.google.com/stackdriver/docs/instrumentation/opentelemetry-collector-gke)):

```sh
export GOOGLE_CLOUD_PROJECT=$PROJECT_ID
for ROLE in roles/logging.logWriter roles/monitoring.metricWriter roles/cloudtrace.agent; do
  gcloud projects add-iam-policy-binding projects/$PROJECT_ID --role=$ROLE --condition=None \
    --member=principal://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$PROJECT_ID.svc.id.goog/subject/ns/opentelemetry/sa/opentelemetry-collector
done
kubectl kustomize https://github.com/GoogleCloudPlatform/otlp-k8s-ingest.git/k8s/base | envsubst | kubectl apply -f -
```

Then set:

```
OTEL_EXPORTER_OTLP_ENDPOINT=http://opentelemetry-collector.opentelemetry.svc.cluster.local:4318
LOG_FORWARD_TO=otlp
```

| Setting | Meaning (default) |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | The collector's base address (default: none, nothing is sent). Plain http is accepted only while `OTEL_EXPORTER_OTLP_HEADERS` is unset. With headers, it must be https, or plain http to the pod's own loopback. |
| `OTEL_EXPORTER_OTLP_HEADERS` | `key=value,key=value`, values percent-encoded (default: none). |
| `LOG_FORWARD_TO` | `otlp` (to the collector), `syslog+udp://HOST:PORT` or `syslog+tcp://HOST:PORT` (RFC 5424; TCP framed by octet counting). Default: none. `otlp` without an endpoint stops the service at start. |

Google's pages name different roles for writing traces (`roles/cloudtrace.agent` on the collector page,
`roles/telemetry.tracesWriter` elsewhere). Use the collector page's roles with the collector page's install.

### 12.3 Data class, rate limits, breakers and budgets

| Setting | Meaning (default) |
|---|---|
| `RUN_DEFAULT_DATA_CLASS` | The class a run carries when nothing else gives it one: `public`, `internal` (default), `confidential` or `restricted`. Tools cleared below it refuse the run's calls. |
| `RATE_RUN_STARTS_PER_MINUTE` | Runs one agent may start per minute (30); 0 turns it off. |
| `RATE_SUB_RUNS_PER_MINUTE` | Sub-runs of one agent per minute (60). |
| `RATE_TREE_PER_MINUTE` | Runs and sub-runs one run tree may start per minute (120). |
| `BREAKER_FAILURES`, `BREAKER_CALLS`, `BREAKER_WINDOW_SECONDS`, `BREAKER_COOLDOWN_SECONDS` | The breakers on tools that act outside: 5 failures in a row; calls off (0) over a 60 s window; 300 s open. |

A reviewed policy change, made in the console, overrides each rate limit and breaker.

**Budgets are not settings.** A person with configure sets them on the FinOps page (`/finops`): an amount in USD per
rolling day, week or month, for the deployment and for each use case. Once a budget is spent, a new run it applies to is
refused (402). A run that a budget applies to may not call a model with no price set (section 6.2).

Other settings, all in the backend's `.env.example`:

- `EGRESS_HOSTS`, the hosts tools may reach;
- `KNOWLEDGE_FETCH_HOSTS`;
- `DENIED_ADDRESS_RANGES`;
- `RETENTION_DAYS`, where only `unused_uploads` may be removed;
- `API_KEY_MAX_LIFETIME_DAYS`;
- `MCP_ALLOWED_ORIGINS`;
- `WEBHOOK_WINDOW_SECONDS`;
- `VENDOR_CONNECTORS`;
- the evaluation and drift thresholds.

---

## 13. Bring-up and checks

### 13.1 In order

1. Project, network and AlloyDB: sections 2 and 3.1.
2. Cluster, sandbox node pool and images: 4.1 to 4.3. Then the database, the user and the extension (3.2).
3. Service accounts and roles: 4.4 and section 5.
4. Model Armor template, files bucket and, if used, Secret Manager: sections 7, 9 and 8.
5. `backend.yaml` held at zero replicas, `settings.env` and the Secret; the migrate Job; one replica; `sandbox.yaml`:
   4.5, 4.6 and 4.8.
6. The console route and the console: section 10.
7. The machine route: section 11.
8. Preflight, sign-in, offering a model and the first run: below.

### 13.2 `preflight` from inside a backend pod

```sh
kubectl exec --namespace agentfactory deploy/agentfactory -- python -m agentfactory preflight
```

Run it while the service runs, in the same image and environment. It makes one real call to each dependency, prints
`pass`, `FAIL` (required) or `warn` (not required) for each, and exits 1 when a required check fails. It prints no
secret. `--json` gives the same for a script. Use `--api-only` only for a deployment that runs no workers on purpose.
The Platform health page (`/observability/health`) runs the same probes.

| Check | Required | Passes when | On Google Cloud, if it fails |
|---|---|---|---|
| `settings` | yes | every setting can be read. If one cannot, this is the only check reported. | the message names the setting and the reason |
| `database` | yes | the pool opened and a query answered | `DATABASE_URL`, `PGPASSWORD` in the Secret, `sslmode=require`, the private services access peering |
| `schema` | yes | every migration in this image is applied | run the migrate Job (4.6) |
| `sign-in audience` | yes | `IAP_AUDIENCE` is set | section 10.4 |
| `sign-in keys` | yes | IAP's keys were read from `IAP_JWKS_URL` (`www.gstatic.com`) | egress from the nodes (2.4), or a mirror |
| `roles` | yes | `IAP_ROLE_MAP` names at least one `platform_admin` | name two |
| `machine address` | yes | `PUBLIC_API_URL` is set | section 11 |
| `console address` | no | `PUBLIC_ORIGIN` is set | section 10.5 |
| `google identity` | no | the metadata server gave a token; prints the account, project and region | the account must be `BACKEND_GSA`. If not: the annotation, the `workloadIdentityUser` binding, `GKE_METADATA` on the node pool |
| `model endpoint vertex` | yes | at least one publisher's model list was read; a refused list is named in the detail. With no endpoint at all, `model endpoints` fails. | `roles/aiplatform.user`; `GCP_PROJECT`, `REGION`, `VERTEX_ENDPOINT` |
| `embeddings` | when knowledge is used | one embedding call to `EMBEDDING_MODEL` answered, with its width | the model is served in `REGION`; `roles/aiplatform.user` |
| `file storage` | yes | a small object was written, read back and deleted | the bucket exists; `roles/storage.objectUser` on it |
| `vault` | yes | `local`: `VAULT_KEY` is a usable key and every stored value opens. `secret-manager`: a list call answered | `VAULT_KEY`, or `GCP_PROJECT` and the two Secret Manager roles |
| `screener` | yes | `platform`: its self-check. `model_armor`: the template was read (`GET`) and has a filter configuration | `MODEL_ARMOR_TEMPLATE`; `roles/modelarmor.viewer`; the template's location |
| `code isolation` | no | `SANDBOX` is set. No Job is run. | section 4.8 |
| `workers` | yes, unless `--api-only` | a worker's heartbeat within the last 30 seconds | `WORKERS`, or the worker Deployment |
| `offered models` | no | at least one model is offered | 13.4 |

Preflight does not check Security Command Center, the IAP access list, knowledge buckets, a sandbox Job, the
collector or A2A. Section 15 lists how to check each.

### 13.3 Signing in

Open the console's address as one of the platform admins. Google asks you to sign in, and the console opens on
Overview with your name at the foot of the sidebar. If it does not, the page you land on says why; the table in the
console's `deploy/console/README.md` ("Check it") maps each page to its cause.

### 13.4 Offering a model

As a platform admin, open Configuration → Models (6.2). Offer at least one model, set its price and make it the
default. Run preflight again: `offered models` passes. A second platform admin is needed for every deployment review.

### 13.5 The four use cases' workloads

The Workloads page (`/workloads`) shows the four workloads the console knows: `sast`, `pentest`, `firewall` and
`threat_hunt`. Two settings drive it:

| Setting | Meaning |
|---|---|
| `WORKLOAD_URLS` | JSON, workload id → the http(s) address of that workload's own console. A workload named here is one the deployment offers. One not named shows as not offered. |
| `WORKLOAD_AGENTS` | JSON, workload id → the id of the agent that runs it. A workload not named here is run by the agent with the workload's own id. `threat_hunt` must be named, because agent ids cannot contain `_`. |

The agent named may also be an **attached agent** (Configuration → Connections → Third-party agents): its own code,
running outside the platform and using the SDK (`sdk/`). It runs the workload: the runs it opens are filed under the
workload, and so are the findings it records with `finding.record`, once that tool is in its grants. The platform
never starts it; a start asked for from the console is refused, saying so.

Each offered workload shows a status, read from the database on every load:

- `not_deployed`: its agent has no deployed version (and is not an attached agent);
- for an attached agent: `attachment_awaiting_approval` (a second person has not approved it), `attachment_detached`,
  `attachment_blocked`, or `locked_down`;
- `no_use_case`;
- `use_case_draft`, or `use_case_awaiting_approval`;
- `available`: its agent is deployed (or attached and approved) and its use case approved by a second person.

**Adding agents is out of scope for this build, and the backend repository ships no agent definitions for the four
workloads.** On a new deployment, every offered workload therefore reads `not_deployed` until the agents that run them
are delivered and deployed, or attached and approved. The four workload consoles are separate products, and the backend
does not check their addresses.

---

## 14. Operating it

**Upgrades.** Rebuild the backend image. Then, in this order:

1. Run the migrate Job with the new image (4.6).
2. Roll the Deployments:

   ```sh
   kubectl set image deployment/agentfactory api=NEW_BACKEND_IMAGE --namespace agentfactory
   kubectl set image deployment/agentfactory-worker worker=NEW_BACKEND_IMAGE --namespace agentfactory   # if used
   kubectl rollout status deployment/agentfactory --namespace agentfactory
   ```

Points to know:

- Nothing in the code promises that the previous image works against the new schema, and no rolling upgrade has been
  rehearsed. Keep the time between the migrate and the rollout short.
- Migrations have no down step. After a migration has run, going back means restoring AlloyDB from a backup or to a
  point in time, into a new cluster.
- The console is redeployed with `gcloud run deploy` and a new image. Rebuild it whenever its address changes.

**Settings.** Re-create the Secret and restart (4.5).

**Rotating `VAULT_KEY` is not supported.** With `SECRETS=local`, a value written under another key makes every vault
listing answer 503 naming `VAULT_KEY`. The only way to change the key is to set every credential again under the new
key, which means knowing every value, or to remove the credentials. Keep `VAULT_KEY` outside the cluster as well: a
database restored without it has credentials no one can open. With `SECRETS=secret-manager` there is no key to
rotate. Set a credential again under the same name to rotate the credential itself.

**API keys expire.** A key lives `API_KEY_MAX_LIFETIME_DAYS` days (default 90; 1 to 3650), or fewer if it was minted
for fewer. From that moment it is refused, whatever it was minted with. Mint the replacement under Configuration →
Access before the old key expires, and revoke the old one. A key never holds `approve`, `iam` or `configure`.

**Backups.**

- **AlloyDB.** Continuous backup is on by default, with a 14-day point-in-time window (1 to 35 days).
  ```sh
  gcloud alloydb clusters update agentfactory --continuous-backup-recovery-window-days=WINDOW_LENGTH \
    --region=$GCP_REGION --project=$PROJECT_ID
  ```
  Add scheduled backups with `--automated-backup-days-of-week`, `--automated-backup-start-times` and
  `--automated-backup-retention-count` (or `--automated-backup-retention-period`). Sources:
  [backup overview](https://docs.cloud.google.com/alloydb/docs/backup/overview),
  [configure backups](https://docs.cloud.google.com/alloydb/docs/backup/configure).
- **The files bucket** holds the bytes of uploads that the database records. Use your bucket protection
  (soft delete, versioning).
- **The secrets.** `VAULT_KEY` (with `local`) and Secret Manager's secrets (with `secret-manager`) are outside the
  database. Back them up by your own means.

**Where the audit trail and evidence live.** All of it is in AlloyDB:

| Table | Holds |
|---|---|
| `audit_events` | every sign-in, every permitted change and every refusal; each row carries a hash over itself and the row before it |
| `journal_entries` | every run's journal, hash-chained per run |
| `access_log` | who opened what |
| `finding_history`, `deliverable_history`, `acceptance_signoffs`, `knowledge_admissions` and the other history tables | the changes to findings, deliverables, sign-offs and admissions |

Evidence packs (the Evidence page) are built on request from these records, with each cited run's chain checked again.

The append-only rule is a database trigger (`refuse_change`), and it binds the service. A role that owns the tables can
still drop the trigger, and the backend's own user owns them because it ran the migrations. The hash chain shows a
missing or altered row. Check it:

```sh
kubectl exec --namespace agentfactory deploy/agentfactory -- python -m agentfactory verify-audit
```

It exits 1 when the chain is broken. `LOG_FORWARD_TO` keeps a copy outside the database (12.2). `RETENTION_DAYS` can
remove only unused uploads; evidence is never removed.

**Logs.** The service logs to standard error at `LOG_LEVEL` (default `info`). GKE's logging collects them if it is
enabled on the cluster.

---

## 15. What is proven and what is not

**None of the following has been run against a real Google service.** Each was built from Google's documentation and
checked only against local stand-ins (`dev/standins/`, the check scripts in `dev/smoke/`) or a local Kubernetes
cluster. The backend's README ("Proven only against stand-ins") says how far each one went. Check each item on the
first day, in this order.

| Dependency | How far it is proven | First-day check |
|---|---|---|
| **AlloyDB** | Never used. The schema and pool were rehearsed on Postgres 16 with pgvector 0.8.6 in a container. | The migrate Job prints every migration as applied. Preflight passes `database` and `schema`. On the Knowledge page, admit a document and search for it. |
| **GKE** | `deploy/k8s/` has not been applied to any cluster. The Kubernetes sandbox ran on a local cluster without gVisor or Workload Identity. | The pod becomes ready. `google identity` names `BACKEND_GSA`. Run one agent step that calls `sandbox.execute` and read its answer. On a gVisor Pod, check that the Job's `seccompProfile: RuntimeDefault` (required by Pod Security "restricted") is accepted: Google says seccomp "isn't supported in sandboxed Pods" without saying whether such a Pod is refused. Check that a Job is refused when you delete the deny-all policy, then put it back. |
| **IAP on Cloud Run** | Only against `dev/standins/iap.py`, which signs as Google documents. | Sign in as a platform admin, then as the auditor (every action disabled), then as someone outside the role map (refused). Check that sign-out works. |
| **Vertex AI** | Only against stand-ins (`VERTEX_ENDPOINT`, `GCP_METADATA_HOST`). Not confirmed from Google's pages: the regional `v1` OpenAI-compatible path (Google shows `v1beta1`); the `v1beta1` publisher list on the `global` and multi-region hosts; which permission that list needs; and the `:predict` embedding call at the chosen location. | Preflight passes `model endpoint vertex` and `embeddings`. The Vertex panel lists models. Offer one model and run a one-step agent: the run's record shows the call, its tokens and its cost. Try one structured (`json_schema`) step and one tool-calling step. |
| **Model Armor** | Only against a stand-in in `dev/smoke/guardrails.py`. | Preflight passes `screener`. Run a prompt containing a known injection phrase: the record shows `modelarmor.prompt.pi_and_jailbreak` and a block. Run a plain one: no verdict. Pass a large tool result to see how Model Armor's size limits behave. |
| **Secret Manager** | No call has been made to it, not even to a stand-in. | Preflight passes `vault`. Set a credential under Configuration → Access → Credentials; check that the secret `agentfactory-vault-NAME` exists with the label `agentfactory=vault`, use it in a tool call, then remove it. Check that your organization policy allows `global` (automatic replication). |
| **The files bucket** | No check script has used it; trials used `FILES_DIR`. | Preflight passes `file storage`. Upload a dataset on the Datasets page and download it again. |
| **The knowledge bucket** | Only against `dev/standins/bucket.py`. | Register a connector on a test prefix; admit it as a second person; sync now; check the objects and their state on the Knowledge page. |
| **Security Command Center** | Only against a stand-in server in `dev/smoke/assurance.py`. | The Control page lists findings, or shows Google's refusal with the reason. |
| **The IAP access list** | Only against a stand-in. Whether the three `iap.*.getIamPolicy` permissions can be used in a custom role is not confirmed. | The identity pages show who IAP lets through. If the custom role cannot be created, the panel shows the refusal; `roles/iap.admin` also works but can change the list. |
| **The machine route** | Not built on Google Cloud. Not confirmed: that `GCPBackendPolicy.timeoutSec` applies to `gke-l7-rilb`, and which port a HealthCheckPolicy probes when none is named (the guide names 8080). | The load balancer reports the backends healthy. From a VM in the VPC, mint a key and call `GET https://API_HOST/api/runs` with `Authorization: Bearer KEY`. Call a path outside the HTTPRoute and check that it is not served. Make a model call through `/api/gateway/v1` that runs longer than 30 seconds. |
| **Cloud Run to the internal LB** | Not built. Google confirms only that Direct VPC egress reaches internal IP addresses in general. | The console loads data. With every page showing 500s, the console's log names the address it could not reach. |
| **The OpenTelemetry collector** | Only against a stand-in collector in `dev/smoke/assurance.py`. Not confirmed: that Google's collector takes OTLP/HTTP with JSON bodies. | With `LOG_FORWARD_TO=otlp`, audit rows appear in Cloud Logging within a minute. Send one run's trace with `POST /api/observability/export`. |
| **A2A** | End to end between a copy of the service and a stand-in peer over https on one machine (`dev/smoke/peers_a2a.py`). | Fetch `https://API_HOST/.well-known/agent-card.json`, then exchange one task with an approved peer. |

These have never been tried at all: a rolling upgrade, a restore of AlloyDB, and more than one backend replica on a
cluster.
