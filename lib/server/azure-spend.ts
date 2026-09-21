/**
 * Billed spend for the Foundry resource, from Azure Cost Management.
 *
 * The inference endpoint knows nothing about money: a data-plane key can
 * answer a chat completion and list deployments, and that is all. What Azure
 * actually charged lives in Cost Management on the management plane, which
 * takes an Entra token, never an API key. So this needs a service principal
 * with Cost Management Reader on the subscription (or the resource group):
 *
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET   the principal
 *   AZURE_SUBSCRIPTION_ID                                   the scope
 *   AZURE_FOUNDRY_RESOURCE_ID   (optional) the resource's ARM id, to bill
 *                               the Foundry resource alone rather than the
 *                               whole subscription
 *
 * Figures are what Azure reports, which lags usage by several hours to a
 * day. The journalled figure beside it (tokens × configured price) is what
 * happened; this is what was billed. Both are shown; neither pretends to be
 * the other.
 */

export interface AzureSpend {
  configured: boolean;
  /** Variables still unset when not configured. */
  missing: string[];
  scope: "resource" | "subscription" | null;
  currency: string | null;
  /** Month to date, in `currency`. */
  mtd: number | null;
  /** Trailing seven days, in `currency`. */
  last7d: number | null;
  daily: { date: string; cost: number }[];
  fetchedAt: string | null;
  error: string | null;
}

const REQUIRED = ["AZURE_TENANT_ID", "AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_SUBSCRIPTION_ID"] as const;

let cache: { at: number; value: AzureSpend } | null = null;
const TTL_MS = 10 * 60_000;

function unconfigured(missing: string[]): AzureSpend {
  return { configured: false, missing, scope: null, currency: null, mtd: null, last7d: null, daily: [], fetchedAt: null, error: null };
}

async function token(tenant: string, client: string, secret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: client,
      client_secret: secret,
      scope: "https://management.azure.com/.default",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(String(data.error_description ?? data.error ?? `token HTTP ${res.status}`).slice(0, 200));
  }
  return String(data.access_token);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function azureSpend(): Promise<AzureSpend> {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) return unconfigured(missing);
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const tenant = process.env.AZURE_TENANT_ID!;
  const client = process.env.AZURE_CLIENT_ID!;
  const secret = process.env.AZURE_CLIENT_SECRET!;
  const sub = process.env.AZURE_SUBSCRIPTION_ID!;
  const resourceId = process.env.AZURE_FOUNDRY_RESOURCE_ID ?? "";
  const scope = resourceId ? "resource" : "subscription";

  // One daily query covering both windows: from the earlier of the first of
  // the month and seven days ago, to today. Month to date and the trailing
  // week are both sums over the rows that come back.
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const weekAgo = new Date(now.getTime() - 6 * 86_400_000);
  const from = first < weekAgo ? first : weekAgo;

  try {
    const bearer = await token(tenant, client, secret);
    const body: Record<string, unknown> = {
      type: "ActualCost",
      timeframe: "Custom",
      timePeriod: { from: `${ymd(from)}T00:00:00Z`, to: `${ymd(now)}T23:59:59Z` },
      dataset: {
        granularity: "Daily",
        aggregation: { totalCost: { name: "Cost", function: "Sum" } },
        ...(resourceId
          ? { filter: { dimensions: { name: "ResourceId", operator: "In", values: [resourceId] } } }
          : {}),
      },
    };
    const res = await fetch(
      `https://management.azure.com/subscriptions/${sub}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(String(data?.error?.message ?? `Cost Management HTTP ${res.status}`).slice(0, 300));
    }

    const columns: string[] = (data?.properties?.columns ?? []).map((c: { name: string }) => c.name);
    const iCost = columns.indexOf("Cost");
    const iDate = columns.indexOf("UsageDate");
    const iCur = columns.indexOf("Currency");
    const daily: { date: string; cost: number }[] = [];
    let currency: string | null = null;
    for (const row of data?.properties?.rows ?? []) {
      const cost = Number(row[iCost] ?? 0);
      const raw = String(row[iDate] ?? ""); // yyyymmdd
      const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
      daily.push({ date, cost });
      if (iCur >= 0 && row[iCur]) currency = String(row[iCur]);
    }
    daily.sort((a, b) => a.date.localeCompare(b.date));
    const mtd = daily.filter((d) => d.date >= ymd(first)).reduce((s, d) => s + d.cost, 0);
    const last7d = daily.filter((d) => d.date >= ymd(weekAgo)).reduce((s, d) => s + d.cost, 0);

    const value: AzureSpend = {
      configured: true, missing: [], scope, currency: currency ?? "USD",
      mtd, last7d, daily, fetchedAt: new Date().toISOString(), error: null,
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (e) {
    // Configured but not answering: say so, and never show a stale number as
    // a live one.
    const value: AzureSpend = {
      configured: true, missing: [], scope, currency: null, mtd: null, last7d: null, daily: [],
      fetchedAt: null, error: (e as Error).message,
    };
    cache = { at: Date.now() - TTL_MS + 60_000, value }; // retry in a minute, not on every poll
    return value;
  }
}
