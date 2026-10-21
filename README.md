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
| `NEXT_PUBLIC_ORIGIN` | The console's public origin (`lib/site.ts`), used in everything user-facing; never localhost. |
| `FOUNDRY_ENDPOINT`, `FOUNDRY_API_KEY` | The model gateway, for the parts of the console that call a model themselves: the assistant, the authoring conversation, knowledge answers. |
| `AGENTFACTORY_DB_*` | Postgres, for the domains that still read it here (below). |

## What the backend owns

Every request under these prefixes is the backend's (`lib/route-policy.ts` `BACKEND_PREFIXES`, the contract in `backend/CONTRACT.md`): `/api/runs`, `/api/approvals`, `/api/agents`, `/api/author`, `/api/drafts`, `/api/roster`, `/api/keys`, `/api/attached`, `/api/iam`, `/api/vault`, `/api/trigger`, `/api/webhooks`, `/api/queue`, `/api/worker` and `/api/healthz`. No route file under `app/api` answers for them (`tests/routes.test.ts`); the typed client in `lib/api/client.ts` is generated from the backend's OpenAPI document and calls them same-origin.

One exception, named in `CONSOLE_UNDER_BACKEND`: `/api/author/chat` is the console's own authoring loop (the conversation goes to Foundry; every runtime step is a call to the backend's `/api/author/reference` and `/api/author/propose`).

## What still runs in Next

Until later phases move them, these answer from `app/api` here, against Postgres and the runtime workspace where they always did:

- **Knowledge**: sources, fetch, admit, search, the agentic answer loop and the document view (`/api/knowledge/*`), with the local cross-encoder rerank.
- **Evals**: sets and history (`/api/evals`), and the runner (`/api/evals/run`), which starts each case on the backend's runs door and grades the record here.
- **FinOps** (`/api/finops`), providers and model discovery (`/api/providers/*`, `/api/models`), the deployment config (`/api/config`), and the configuration read (`/api/configuration`, which reads vault names, keys and the queue from the backend's doors).
- **Control aggregation** (`/api/control`, `/api/guardrails`, `/api/logs`, `/api/artifact`).
- **The assistant** (`/api/assistant`) and its tool catalogue (`lib/server/console-tools.ts`).
- **Observability** (`/api/observability`, `/api/observability/export`).
- **The MCP registry** (`/api/mcp`) and the **platform MCP server** (`/api/mcp/server`).
- **The model gateway**, **SDK door** and **A2A door** for attached agents (`/api/a2a/*`, `/api/sdk/*`), with the agent card at `/.well-known/agent.json`.
- Sign-in (`/api/auth/*`) and the UI preferences (`/api/ui`).

The machine doors among these (`/api/sdk*`, `/api/a2a*`, `/api/mcp/server`) keep their own API keys and stay outside the cookie gate, as do the backend's trigger, webhook and worker doors.
