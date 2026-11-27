# Saros console


**Deploying this release and joining the SAST tool, on one page: [`deploy/HANDOVER.md`](deploy/HANDOVER.md).** Upgrading a running deployment: [`deploy/UPGRADE.md`](deploy/UPGRADE.md) (the same file as in the service's repository). Joining the SAST tool: [`deploy/SAST.md`](deploy/SAST.md).

The console is the pages of Saros: a Next.js app (app router, React 19) that runs in the browser and calls the platform's service for everything it shows or changes. It keeps no data, no session and no setting of its own beyond the two below. It has no API routes of its own: its only server-side logic is `proxy.ts`, which forwards.

## How it fits

```
browser ──► Google IAP ──► console (Next.js) ──► platform service (BACKEND_ORIGIN)
                            pages                every /api request, unchanged
```

- **Sign-in.** Google Identity-Aware Proxy signs a person in before a request reaches the console. The console forwards every `/api` request with its headers unchanged, IAP's signed assertion (`x-goog-iap-jwt-assertion`) among them. The service verifies that assertion on every request, gives the person their role from its role map, and answers who is signed in (`GET /api/auth/session`) and whether they may enter (`GET /api/auth/login`, which sends a person it refuses to `/no-access` with the reason). The console decides nothing about who someone is or what they may do; it greys out what the session says a person may not do, and the service refuses it anyway.
- **Forwarding.** `proxy.ts` sends every `/api` request, and the agent card at `/.well-known/agent.json`, to `BACKEND_ORIGIN`. The one check it makes first: a write must come from the console's own origin (`NEXT_PUBLIC_ORIGIN`), since IAP's own session rides on a cookie. Without `BACKEND_ORIGIN` it answers every request 503 with the reason. There is no console-only mode.
- **Machine addresses.** Applications, attached agents, triggers, webhooks and MCP clients reach the service on its own route, not through the console. The console prints those addresses from the session's `machineOrigin` (the service's `PUBLIC_API_URL`), read at run time, and prints none where the service names none (`lib/site.ts`).
- **Reading answers.** Each screen reads its doors through the mapping functions in `lib/api/*`; the doors read through `ask` are named once in `lib/api/pending.ts`, where the service's 501 (a part it names as not built) is told apart from any other refusal.

## Settings

| Variable | When | Meaning |
|---|---|---|
| `NEXT_PUBLIC_ORIGIN` | build | The address people open the console at, in full, no trailing slash. Compiled into the pages. |
| `BACKEND_ORIGIN` | run | The service's address as the console's server reaches it. |

Sign-in (`IAP_AUDIENCE`, `IAP_ROLE_MAP`, `IAP_SIGNOUT_URL`, `IAP_JWKS_URL`), the machine route (`PUBLIC_API_URL`) and everything else are the service's settings. `.env.example` lists the console's.

**To deploy on Google Cloud, follow [`deploy/GCP.md`](deploy/GCP.md)**: both parts, the console and the service, step by step (the same file is in the service's repository). `deploy/console/README.md` has the console's own part.

## Run it locally

The console needs the service running and a stand-in for IAP in front of it, since the service refuses a request that IAP did not sign.

```bash
npm ci
BACKEND_ORIGIN=http://localhost:8471 NEXT_PUBLIC_ORIGIN=http://localhost:8098 npx next dev -p 3200
```

Then open the console through the IAP stand-in at the address `NEXT_PUBLIC_ORIGIN` names. The service's repository has the stand-in (`dev/standins/iap.py serve --port 8098 --to http://localhost:3200`), which signs assertions the way IAP documents them; the service must be started with the matching `IAP_AUDIENCE` and `IAP_JWKS_URL`.

```bash
npx tsc --noEmit -p .  # types
npm run lint           # eslint
npm test               # vitest
```

## The types of the service's answers

`lib/api/backend.d.ts` types the typed client in `lib/api/client.ts`. It was generated from an earlier version of the service's OpenAPI and is now kept by hand: the service's `/openapi.json` lists its paths but not its answer shapes, so generating from it would drop every type the screens name. The mapping functions in `lib/api/*` are what each screen relies on, and they read every answer at run time.

## Tests

`tests/` holds the console's own logic against shapes built in the test and against answers captured from an earlier version of the service (`tests/fixtures/`, and inline fixtures in the `l*-contract` tests). The captures were taken from an earlier version of the service and have not been taken again from the current one.
