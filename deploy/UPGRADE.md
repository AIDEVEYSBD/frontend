# Upgrading an existing deployment

The same file is in both repositories (the backend and the console). It tells a team that already deploys Saros
from its own pipeline what to change. Each section is one upgrade, newest first. `deploy/GCP.md` stays the full
reference.

To see every changed file yourself, run in each repository:

```sh
git fetch origin
git diff --name-status FROM_COMMIT origin/BRANCH    # A added, M modified, D deleted, R renamed
git diff FROM_COMMIT origin/BRANCH > changes.patch  # the full diff
```

---

## 27 November 2026, second release: chatbot and model-call fixes

**Nothing changes in your pipeline.** There are no new build arguments, settings, files to apply or database
migrations. Rebuild both images from the new commits and roll them out as usual.

| What | Where |
|---|---|
| The chatbot has a full page (`/ask`, "Assistant" in the menu); the drawer can dock on the right; a click in an answer opens a card in the chat | console |
| Broken model replies are asked again, the chatbot leaves room for the model's reasoning and asks Gemini for low reasoning effort (answers are several times faster) | backend |
| Claude and other Model Garden partner models can be called once enabled in the project | backend |

**One setting to check if the console runs on GKE behind an Ingress:** the load balancer's default response
timeout is 30 seconds, which cuts off chatbot answers. `deploy/console/console.yaml` now sets `timeoutSec: 3600` in
its BackendConfig; apply that file again, or add the line to yours. On Cloud Run, set the request timeout to 3600
seconds (`--timeout=3600`).

---

## 27 November 2026: backend `abb` at `10ff27b`, console `abb-platform` at `144f8e3`

**From:** the code pushed on 24 November (backend `3a92d18`, console `e36228b`). If your pipeline builds the console
from branch `abb-brand`, read the next section as well.

**The changed files and full diffs** are in each repository under `deploy/changes/2026-11-27/`.

### What changed for your pipeline

| Item | Change | What your pipeline does |
|---|---|---|
| Deleted or renamed files | none, in either repository | nothing |
| Build arguments, Dockerfiles, base images | unchanged (comments only) | nothing |
| Environment variables and settings the images need | none new | nothing |
| Database | two new migrations: `0032_gateway_tool_calls.sql`, `0033_gateway_reasoning_effort.sql` | run the migrate Job **before** rolling out the backend, as `GCP.md` §4.6 and §14 say. If your backend runs with `AUTO_MIGRATE=1`, it migrates on start and you need do nothing |
| Kubernetes manifests (`deploy/k8s/`, `deploy/console/`) | unchanged | nothing |

**Your upgrade, in order:**
1. Build and push both images from the new commits.
2. Run the backend's migrate Job with the new image, and wait for it to complete.
3. Roll out the backend.
4. Roll out the console.
5. Run `preflight` in the backend pod (`GCP.md` §13.2). Every required check must pass.

### What is new in the product (no pipeline change)
- The model gateway takes tool calls, streaming and `reasoning_effort`. Each tool result is screened once.
- Empty text is no longer sent to Model Armor. That was refusing calls as "screener unavailable".
- A use case can be run by an **attached agent** (an agent outside the platform using the SDK). This is how the SAST tool joins.
- Guardian rules may name attached agents.
- The product is called **Saros** wherever a person reads it. Machine names (the `agentfactory` package, image, namespace and settings names, the `X-Agentfactory-Run` header) are unchanged.
- The chatbot answers questions about Saros with tiles, tables and links, and the console has no long explanatory paragraphs.
- Model Garden partner models (Claude and others) can be called. This needs Claude enabled in your project's Model Garden first (`GCP.md` §6).

### Settings you may want (in the backend's settings Secret; re-create it and restart, `GCP.md` §4.5)

| Setting | When |
|---|---|
| `WORKLOAD_URLS={"sast":"https://SAST_HOST"}` | once the SAST tool is joined: the Workloads page lists it and links to its screens |
| `VERTEX_PUBLISHERS=google,anthropic` | once Claude is enabled in Model Garden: the Models page then offers it |

### What a real deployment taught (added to `GCP.md`)
| If you see | Do |
|---|---|
| GKE cluster ends in ERROR | the org requires Shielded VMs: add `--shielded-secure-boot --shielded-integrity-monitoring` to the cluster and every node pool (§4.1) |
| `kubectl` hangs against a private cluster | `gcloud container clusters update CLUSTER --enable-dns-access`, then `get-credentials --dns-endpoint` (§4.1) |
| Every model call refused "screener unavailable" and nodes have no NAT | Model Armor needs a Private Service Connect endpoint (§2.4) |
| Google "Server Error" on an Ingress address | set the BackendConfig health check to the app's health path and port |

### Joining the SAST tool
Follow `deploy/SAST.md`, which has both halves: what the Saros side sets up, and what the SAST team deploys.

---

## Console from `abb-brand` (the console-only build of 17 November) to `abb-platform`

If your console pipeline still builds branch `abb-brand`, the console became a front end for the backend. Change
the console pipeline:

| Item | Before (`abb-brand`) | Now (`abb-platform`) |
|---|---|---|
| Branch | `abb-brand` | `abb-platform` |
| Cloud Build substitutions (`deploy/console/cloudbuild.yaml`) | `_IMAGE`, `_ORIGIN`, `_QUIET` | `_IMAGE`, `_ORIGIN` only. Remove `_QUIET` from your trigger, or the build fails on an unknown substitution |
| Build arguments | `NEXT_PUBLIC_ORIGIN`, `NEXT_PUBLIC_CONSOLE_QUIET` | `NEXT_PUBLIC_ORIGIN` only |
| Run-time settings on the console | `IAP_AUDIENCE`, `IAP_ROLE_MAP` (in `env.cloudrun.yaml`) | `BACKEND_ORIGIN` only. `IAP_AUDIENCE` and `IAP_ROLE_MAP` move to the **backend's** settings |
| Console service account | read Vertex AI and IAP | needs no role (the console calls no Google API) |
| Network (Cloud Run) | none | Direct VPC egress to the backend's internal load balancer: `--network NETWORK --subnet SUBNET --vpc-egress=private-ranges-only`, with `BACKEND_ORIGIN=http://BACKEND_ILB_IP` (`GCP.md` §10.2–10.3) |
| Files | 92 files deleted, mostly the console's own `app/api/*` routes, now served by the backend. A build from the branch handles this; a pipeline that copies files must delete them too | — |

You also need the **backend** deployed (`GCP.md` §2–§9 once; then its pipeline as above). The console answers 503
until `BACKEND_ORIGIN` reaches it.
