# Deploying this release, and joining the SAST tool

For the team deploying Saros on its own Google Cloud. One page: what to deploy, in what order, what to click
afterwards, and how the SAST tool joins. The same file is in both repositories. The detail behind every step is in
`deploy/GCP.md`; the links below point to its sections.

## 1. What you are deploying

| Part | Repository branch | Commit | Runs on |
|---|---|---|---|
| Backend (the service) | `abb` | `abfcc91` or later | GKE |
| Console (the pages) | `abb-platform` | `73ec7be` or later | Cloud Run, or GKE behind an Ingress |

The product is called **Saros** on screen. Its machine names still say `agentfactory` (image, namespace, settings,
commands): use them exactly as written.

## 2. If Saros is already deployed: upgrade

Your pipeline needs **no change**: no new build arguments, settings or files.

1. Build and push both images from the commits above.
2. Run the backend's migrate Job with the new image and wait for it (`GCP.md` §4.6). The 27 November releases add
   migrations `0032` and `0033`. With `AUTO_MIGRATE=1` the backend does this itself on start.
3. Roll out the backend, then the console.
4. Check: `kubectl exec -n agentfactory deploy/agentfactory -- python -m agentfactory preflight`. Every required
   check must pass.
5. **Set the response timeout to one hour** where the console is served, or chatbot answers are cut off at 30 seconds:
   - **Cloud Run:** `gcloud run services update CONSOLE_SERVICE --timeout=3600`.
   - **GKE Ingress:** apply `deploy/console/console.yaml` again (its BackendConfig now carries `timeoutSec: 3600`).

`deploy/UPGRADE.md` lists what each release changed.

## 3. If this is the first deployment

Follow `deploy/GCP.md` from the top. The order, with what a real deployment ran into:

| Step | `GCP.md` | Watch for |
|---|---|---|
| Project, APIs, network, Cloud NAT | §2 | A router quota of zero free: ask Google for more first. |
| AlloyDB, database, `vector` extension | §3 | Create the extension as `postgres` before the first migrate. |
| GKE cluster and sandbox node pool | §4.1–4.2 | An organization that requires Shielded VMs needs `--shielded-secure-boot --shielded-integrity-monitoring`. A private cluster needs `--enable-dns-access` to be reachable. |
| Images | §4.3 | — |
| Service account and roles | §4.4, §5 | Retry a role binding that fails just after the account is made. |
| Settings Secret, migrate, backend | §4.5–4.6 | `IAP_ROLE_MAP` must name **two** platform admins: approvals need a second person. |
| Vertex AI, Model Armor, storage | §6–§9 | Without NAT, Model Armor needs the private endpoint in §2.4. |
| Console behind IAP | §10 | Set `IAP_AUDIENCE` on the backend after the console exists. Set the one-hour timeout (step 5 above). |
| Preflight | §13.2 | Every required check passes. |

## 4. After it is up: in the console

Each step is done by a signed-in platform admin. Where it says "second admin", the person who made the change
cannot approve it.

1. **Models:** Configuration → Models. Offer a model, set its price, clear it for the data classes it may receive,
   and make it the default. For agents that call tools, use Gemini 2.5 Pro or a Gemini 4 model.
2. **Use case:** Workloads → Use cases → register (for SAST: workload `sast`), send for approval; the second admin
   approves.
3. **Agent:** Configuration → Connections → Third-party agents → attach (id `sast`, grant `finding.record`); the
   second admin approves. Put the key it shows straight into the cluster (§5 below).
4. **Spend caps:** on the agent (a daily cap) and Security and Policy → Policy → guardian (a cap per run); the
   second admin approves.

## 5. Joining the SAST tool

`deploy/SAST.md` is the full guide, in two halves. In short:

**Your side (Saros):**
1. Steps 2–4 above for `sast`.
2. Create the Secret with the agent's key, typed from your shell, never pasted into a chat or a ticket:
   `kubectl -n sast create secret generic agentfactory-agent --from-file=AGENTFACTORY_KEY=/dev/stdin`
3. A database `sast` on the same AlloyDB, with an owner user and an application user (`SAST.md` S8 has the exact
   statements).
4. A sign-in address for the SAST screens: an Ingress with IAP whose BackendConfig health check is `/healthz` on
   the web container's port (`SAST.md` S9), and send the SAST team its IAP audience.
5. Add `WORKLOAD_URLS={"sast":"https://SAST_HOST"}` to the backend's settings and restart.

**The SAST team's side:** build its two images, fill its values file, install with Helm, and run its
`platform-check` (`SAST.md` Part 2).

**It works when:**
- the Workloads page shows SAST as available;
- a scan started from the SAST screens appears under Runs;
- the scan's findings appear on Findings under SAST.

## 6. If something fails

| You see | Cause | Do |
|---|---|---|
| The agent's calls answer 403 `attachment_not_approved` | the second admin has not approved the attachment | approve it (§4 step 3) |
| Model calls answer 503 `screener.unavailable` | Model Armor cannot be reached | the private endpoint or NAT (`GCP.md` §2.4) |
| Google's "Server Error" on an Ingress address | the load balancer's health check asks `/` | set the health path and port in the BackendConfig |
| The chatbot shows "Load failed" after about 30 seconds | the response timeout | §2 step 5 |
| A finding is refused with `modelarmor.response.sdp` | the model quoted a secret's value | the agent masks secrets in findings (the SAST tool does) |
| `kubectl` hangs | a private cluster without the DNS endpoint | `GCP.md` §4.1 |
| A kill seems slow | the agent was inside a model call | from this release the call is cut off within about 2 seconds, and the run reads "Stopping" |
