# Agent Factory console

The console is a Next.js app (app router, React 19) that serves the pages and the parts of the API that have not yet moved to the backend. Since phase L2 it is a client of the backend (`backend/`, a FastAPI service with the runtime imported in-process) for everything that touches runs, agents, approvals, drafts, the roster, keys, attached agents, IAM and the vault, and it starts no process of its own: nothing under `app/` or `lib/` spawns `python3` (`tests/no-python.test.ts` holds it to that).

## Run it

```bash
npm install
npm run dev            # next dev; the port is yours to pick with -p
npm test               # vitest: route guards, the path router, the SSE decoder, the no-spawn rule
npx tsc --noEmit       # types
npm run lint           # eslint
npm run gen:api        # regenerate lib/api/backend.d.ts from ../backend/openapi.json
```

Point it at a backend before opening anything beyond the landing page: without `BACKEND_ORIGIN` the paths the backend owns have no answer here, so the Workflows, Runs, Control, Configuration, IAM and Builder pages read empty or 503.

## Environment

| Variable | Meaning |
|---|---|
| `BACKEND_ORIGIN` | **Required for anything beyond the pages.** The backend's origin (`http://localhost:8000` on a laptop, the container's name inside the compose network). The path router in `proxy.ts` forwards every backend-owned prefix there at request time, with the session cookie forwarded and the runtime key attached; route handlers that still live here reach the same doors through `lib/server/backend.ts` on the caller's behalf. |
| `RUNTIME_KEY` | The shared secret the backend expects in `x-runtime-key`; set the same value on both sides when the API is closed. |
| `RUNTIME_ORIGIN` | Split deployment (the Vercel console): every API path the backend does not own is proxied to the control plane behind the tunnel. |
| `AUTH_SECRET` | Sign-in on: the session cookie's HMAC key, verified here without a database and again by the backend. Unset means local mode, where every request is the operator holding `AUTH_LOCAL_ROLE`. |
| `AUTH_LOCAL_ROLE` | Local mode's role (administrator, operator, viewer). |
| `AUTOX_CLIENT_ID`, `AUTOX_CLIENT_SECRET`, `AUTOX_ISSUER` | The identity provider, for sign-in. |
| `AUTH_GROUPS_CLAIM` | The claim the identity provider puts a person's groups in, stored on the session at sign-in (and on each refresh whose tokens carry it) so a gate's approvers can name a group (plan L5). Default `groups`. Read from the ID token and the access token together; a claim name with `:`, `/` or `.` is read as a literal key first, then as a dotted path into a nested claim (`realm_access.roles`). Values are kept as sent (names, or object ids from Entra ID), so a gate names a group exactly as the provider spells it. A provider that withholds the list (Entra ID's groups overage) is noted on the sign-in event; the console does not call Microsoft Graph. |
| `NEXT_PUBLIC_ORIGIN` | The console's public origin (`lib/site.ts`), used in everything user-facing; never localhost. |
| `FOUNDRY_ENDPOINT`, `FOUNDRY_API_KEY` | The model gateway, for the parts of the console that call a model themselves: the assistant, the authoring conversation, knowledge answers. |
| `AGENTFACTORY_DB_*` / `AGENTFACTORY_DB_DSN` | Postgres, for the domains that still read it here (below): host, port, name, user and password, or one connection string. The DSN also switches on the DB-backed schema test in `tests/registry-db.test.ts`, which works in a scratch schema of its own. |
| `KNOWLEDGE_DB_*` / `KNOWLEDGE_DB_DSN` | The knowledge index (pgvector, `docker compose up -d vectors`, port 5458 on a laptop): host, port, name, user and password, or one connection string. The DSN also switches on the DB-backed test in `tests/knowledge-db.test.ts`. |

## What the backend owns

Every request under these prefixes is the backend's (`lib/route-policy.ts` `BACKEND_PREFIXES`, the contract in `backend/CONTRACT.md`): `/api/runs`, `/api/approvals`, `/api/agents`, `/api/author`, `/api/drafts`, `/api/roster`, `/api/keys`, `/api/attached`, `/api/iam`, `/api/vault`, `/api/trigger`, `/api/webhooks`, `/api/queue`, `/api/worker`, `/api/screener`, `/api/applications`, `/api/gateway`, `/api/retrieval`, `/api/apps`, `/api/attention`, `/api/fleet`, `/api/lockdown`, `/api/answer`, the MCP registry (`/api/mcp`), the SDK door (`/api/sdk`), the ports' health doors (`/api/ports/{name}/health`) and `/api/healthz`. No route file under `app/api` answers for them (`tests/routes.test.ts`); the typed client in `lib/api/client.ts` is generated from the backend's OpenAPI document and calls them same-origin.

Two exceptions, named in `CONSOLE_UNDER_BACKEND`: `/api/author/chat` is the console's own authoring loop (the conversation goes to Foundry; every runtime step is a call to the backend's `/api/author/reference` and `/api/author/propose`), and `/api/mcp/server` is the platform's own MCP server, served here under the backend's registry prefix.

## What still runs in Next

Until later phases move them, these answer from `app/api` here, against Postgres and the runtime workspace where they always did:

- **Knowledge**: sources, fetch, admit, search, the agentic answer loop, the document view and which admitted documents are stale against their source (`/api/knowledge/*`; the last feeds the per-application view), with the local cross-encoder rerank.
- **Evals**: sets and history (`/api/evals`), and the runner (`/api/evals/run`), which starts each case on the backend's runs door and grades the record here.
- **FinOps** (`/api/finops`), providers and model discovery (`/api/providers/*`, `/api/models`), the deployment config (`/api/config`), and the configuration read (`/api/configuration`, which reads vault names, keys and the queue from the backend's doors).
- **Control aggregation** (`/api/control`, `/api/guardrails`, `/api/logs`, `/api/artifact`).
- **The assistant** (`/api/assistant`) and its tool catalogue (`lib/server/console-tools.ts`).
- **Observability** (`/api/observability`, `/api/observability/export`).
- **The platform MCP server** (`/api/mcp/server`).
- **The A2A doors** for attached agents (`/api/a2a/*`: the model gateway alias, the tool broker, the tasks door), with the agent card at `/.well-known/agent.json`. The tool broker starts a registered stdio server to make one call; it refuses, naming the reason, a server registered with `isolate` or with `${secret:…}` references in its environment, which only the backend can honour.
- Sign-in (`/api/auth/*`) and the UI preferences (`/api/ui`).

The machine doors among these (`/api/a2a*`, `/api/mcp/server`) keep their own API keys and stay outside the cookie gate, as do the backend's trigger, webhook, worker and SDK doors.

## Knowledge namespaces

The knowledge index holds one corpus per engagement, in one store. Every row (sources, documents, sections, chunks, admissions) carries a `namespace`, and every read and write under `/api/knowledge/*` names one: `namespace` in the JSON body or the query string, matching `^[a-z0-9][a-z0-9-]{0,62}$`. A search in one namespace never returns another's passages; the predicate is in the SQL (`lib/server/knowledge-sql.ts`), not applied after, and `tests/knowledge-namespace.test.ts` holds every statement to it.

- **The default.** A request that names no namespace reads and writes `default`, which is where an index built before namespaces keeps everything it had. The console assistant's `search_knowledge` tool and the platform MCP server search `default` unless the call passes `namespace`.
- **Picking one.** The Knowledge page has a corpus picker in its header, fed by `GET /api/knowledge?namespaces=1` (the namespaces that exist, the default always among them) plus "new…", which takes a name and opens it. The choice is remembered per browser and sent on every call the page makes: status, fetch, document, admit, search and answer.
- **What a new namespace starts with.** The curated catalogue, seeded on first read, with every source enabled; nothing fetched, nothing admitted. Curation (enabling a source, admitting a document, superseding an older version) acts on that namespace alone.
