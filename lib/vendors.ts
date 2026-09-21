/**
 * The connector catalogue: every system we say this platform reaches.
 *
 * One list, two readers. The landing page renders it as the integration wall;
 * the builder's Connectors tab renders it as cards you can drop onto an agent.
 * They cannot drift, because there is nowhere for them to drift to.
 *
 * Each entry names the backend it speaks through. That is the honest part of
 * this file: the platform does not carry 134 bespoke integrations, it carries
 * a small set of backends — a log API, a REST register, a document store, a
 * git checkout, a mail transport — and a vendor is a configured instance of
 * one of them. Dropping "Splunk" onto an agent attaches the log-API connector
 * named `splunk`, grants the owning tool, and leaves the endpoint and key for
 * whoever wires it. The agent never learns which product answered, which is
 * the same reason a spec survives moving from one client to the next.
 *
 * Adding a vendor is a line here. Adding a *kind* of backend is a row in
 * `connections.ts` plus its runtime class, and that is the harder change on
 * purpose.
 */

export interface VendorGroup {
  name: string;
  /** Palette hue token, shared with the landing wall. */
  c: number;
  items: string[];
  /** The backend a vendor in this group speaks through, unless overridden. */
  via: { tool: string; kind: string };
}

export const VENDOR_GROUPS: VendorGroup[] = [
  {
    name: "Detection & response",
    c: 1,
    via: { tool: "events", kind: "rest" },
    items: ["Microsoft Sentinel", "Microsoft Defender", "Splunk", "CrowdStrike", "SentinelOne", "Palo Alto Networks", "Fortinet", "Cisco", "Check Point", "Trend Micro", "Sophos", "Darktrace", "Elastic", "Sumo Logic"],
  },
  {
    name: "Data protection & network",
    c: 4,
    via: { tool: "events", kind: "rest" },
    items: ["Microsoft Purview", "Forcepoint", "Zscaler", "Netskope", "Proofpoint", "Mimecast", "Cloudflare", "Akamai", "F5"],
  },
  {
    name: "GRC & audit",
    c: 5,
    via: { tool: "records", kind: "rest" },
    items: ["ServiceNow", "Archer", "OneTrust", "AuditBoard", "MetricStream", "LogicGate", "Vanta", "Drata", "Hyperproof", "Workiva", "Diligent", "Jira", "Confluence"],
  },
  {
    name: "Identity & secrets",
    c: 8,
    via: { tool: "records", kind: "rest" },
    items: ["Okta", "Entra ID", "Ping Identity", "Auth0", "SailPoint", "Duo", "CyberArk", "BeyondTrust", "Delinea", "JumpCloud", "1Password", "HashiCorp Vault"],
  },
  {
    name: "Vulnerability & code",
    c: 2,
    via: { tool: "records", kind: "rest" },
    items: ["Qualys", "Tenable", "Rapid7", "Wiz", "Snyk", "Veracode", "Semgrep", "Checkmarx", "Sonar", "JFrog", "Aqua Security", "Orca Security", "GitHub", "GitLab", "Bitbucket", "Azure DevOps"],
  },
  {
    name: "Third-party risk",
    c: 6,
    via: { tool: "records", kind: "rest" },
    items: ["BitSight", "SecurityScorecard", "UpGuard", "RiskRecon", "Panorays"],
  },
  {
    name: "Business systems",
    c: 9,
    via: { tool: "records", kind: "rest" },
    items: ["SAP", "Salesforce", "Oracle", "NetSuite", "Workday", "Dynamics 365", "Coupa", "Concur", "Stripe", "QuickBooks", "Xero", "Bloomberg", "Refinitiv", "Guidewire", "Duck Creek"],
  },
  {
    name: "Documents & data",
    c: 3,
    via: { tool: "retrieval", kind: "documents" },
    items: ["SharePoint", "OneDrive", "Google Drive", "Box", "Dropbox", "iManage", "DocuSign", "Adobe Sign", "Amazon S3", "Azure Blob", "Snowflake", "Databricks", "BigQuery", "Redshift", "Postgres", "SQL Server", "MongoDB", "Elasticsearch", "Kafka", "Fivetran", "dbt", "Tableau", "Power BI", "Notion"],
  },
  {
    name: "Cloud & DevOps",
    c: 7,
    via: { tool: "compute", kind: "http" },
    items: ["Google Cloud", "Kubernetes", "Docker", "Terraform", "Ansible", "Jenkins", "CircleCI", "Datadog", "Grafana", "New Relic", "PagerDuty", "UiPath"],
  },
  {
    name: "Communication & ITSM",
    c: 0,
    via: { tool: "notify", kind: "webhook" },
    items: ["Outlook", "Gmail", "Slack", "Teams", "Zoom", "Webex", "Zendesk", "Intercom", "Genesys", "Five9", "Twilio", "Asana", "Monday.com", "Smartsheet"],
  },
];

/**
 * Vendors whose group default is the wrong backend. A code host is a checkout,
 * not a REST register; a warehouse is queried, not tailed; mail is mail.
 */
const VIA: Record<string, { tool: string; kind: string }> = {
  GitHub: { tool: "code", kind: "git" },
  GitLab: { tool: "code", kind: "git" },
  Bitbucket: { tool: "code", kind: "git" },
  "Azure DevOps": { tool: "code", kind: "git" },

  Slack: { tool: "notify", kind: "slack" },
  Outlook: { tool: "notify", kind: "smtp" },
  Gmail: { tool: "notify", kind: "smtp" },

  Postgres: { tool: "records", kind: "postgres" },
  "SQL Server": { tool: "records", kind: "postgres" },
  MongoDB: { tool: "records", kind: "rest" },
  Snowflake: { tool: "records", kind: "rest" },
  Databricks: { tool: "records", kind: "rest" },
  BigQuery: { tool: "records", kind: "rest" },
  Redshift: { tool: "records", kind: "rest" },
  Tableau: { tool: "records", kind: "rest" },
  "Power BI": { tool: "records", kind: "rest" },
  Elasticsearch: { tool: "retrieval", kind: "tool" },
  Kafka: { tool: "events", kind: "rest" },
  Fivetran: { tool: "compute", kind: "http" },
  dbt: { tool: "compute", kind: "http" },

  Confluence: { tool: "retrieval", kind: "documents" },
  Notion: { tool: "retrieval", kind: "documents" },

  Datadog: { tool: "events", kind: "rest" },
  Grafana: { tool: "events", kind: "rest" },
  "New Relic": { tool: "events", kind: "rest" },
  PagerDuty: { tool: "notify", kind: "webhook" },
};

/** What the product exposes, before the platform puts an MCP in front of it. */
export type Surface = "api" | "db" | "files" | "events" | "webhook";

export interface Vendor {
  name: string;
  group: string;
  c: number;
  tool: string;
  kind: string;
  /** Config name the connector lands under: `microsoft-sentinel`, `splunk`. */
  slug: string;
  /** The interface the product itself offers. */
  surface: Surface;
  /** Whether the vendor publishes its own MCP server, which the platform brokers rather than replaces. */
  nativeMcp: boolean;
  /** Which server that is, and its standing, when nativeMcp is true. */
  nativeMcpNote: string;
}

export const SURFACE_LABEL: Record<Surface, string> = {
  api: "REST API",
  db: "SQL / query engine",
  files: "File store",
  events: "Event stream",
  webhook: "Webhook",
};

const SURFACE_BY_GROUP: Record<string, Surface> = {
  "Detection & response": "api",
  "Data protection & network": "api",
  "GRC & audit": "api",
  "Identity & secrets": "api",
  "Vulnerability & code": "api",
  "Third-party risk": "api",
  "Business systems": "api",
  "Documents & data": "files",
  "Cloud & DevOps": "api",
  "Communication & ITSM": "webhook",
};

const SURFACE_OVERRIDE: Record<string, Surface> = {
  Snowflake: "db", Databricks: "db", BigQuery: "db", Redshift: "db", Postgres: "db", "SQL Server": "db", MongoDB: "db", Elasticsearch: "db", Elastic: "db",
  Kafka: "events", Splunk: "events", "Sumo Logic": "events", Datadog: "events",
  "Amazon S3": "files", "Azure Blob": "files", SharePoint: "files", OneDrive: "files", "Google Drive": "files", Box: "files", Dropbox: "files", iManage: "files",
  Fivetran: "api", dbt: "api", Tableau: "api", "Power BI": "api", Notion: "api", DocuSign: "api", "Adobe Sign": "api",
  Slack: "api", Teams: "api", Outlook: "api", Gmail: "api", Zoom: "api", Webex: "api", Zendesk: "api", Intercom: "api", Asana: "api", "Monday.com": "api", Smartsheet: "api",
  PagerDuty: "webhook", Twilio: "webhook", Genesys: "webhook", Five9: "webhook",
};

/**
 * Vendors that publish an MCP server of their own, with its standing.
 *
 * Checked against the vendors' own announcements and documentation on
 * 2026-09-17. A product not listed here is reached through an MCP server the
 * platform hosts in front of its API, database or file store.
 */
export const NATIVE_MCP: Record<string, string> = {
  // Microsoft
  "Microsoft Sentinel": "Microsoft Sentinel MCP server (Microsoft Learn)",
  "Microsoft Purview": "microsoft/purview-dlm-mcp, data lifecycle diagnostics",
  "Entra ID": "Microsoft MCP Server for Enterprise, public preview",
  SharePoint: "Microsoft Work IQ / Agent 365 MCP servers, preview",
  OneDrive: "Microsoft Work IQ / Agent 365 MCP servers, preview",
  Teams: "Microsoft Work IQ / Agent 365 MCP servers, preview",
  Outlook: "Microsoft Work IQ / Agent 365 MCP servers, preview",
  "Dynamics 365": "Dynamics 365 MCP servers; Customer Service GA",
  "Power BI": "Power BI MCP servers, public preview",
  "Azure DevOps": "microsoft/azure-devops-mcp",
  "Azure Blob": "Azure MCP Server (storage tools)",
  "SQL Server": "Microsoft MSSQL MCP server",
  // security
  CrowdStrike: "crowdstrike/falcon-mcp, public preview",
  SentinelOne: "Sentinel-One/purple-mcp, read-only",
  "Palo Alto Networks": "Cortex MCP server",
  "Trend Micro": "trendmicro/vision-one-mcp-server",
  Splunk: "Splunk MCP Server, GA (Splunkbase)",
  Elastic: "Elastic MCP server",
  Elasticsearch: "Elastic MCP server",
  "Sumo Logic": "Sumo Logic MCP server, limited beta",
  Cisco: "Cisco MCP servers (Webex, Splunk, Meraki)",
  Zscaler: "zscaler/zscaler-mcp-server, public preview",
  Netskope: "Netskope hosted MCP server, technology preview",
  Cloudflare: "Cloudflare MCP servers",
  Wiz: "Wiz MCP Server, preview",
  Tenable: "Tenable Hexa AI MCP server, hosted",
  Qualys: "qualys-cli-mcp, official",
  "Orca Security": "orca-mcp-server, official",
  Checkmarx: "Checkmarx MCP, hosted",
  Snyk: "Snyk MCP server",
  Semgrep: "semgrep/mcp",
  JFrog: "JFrog MCP server",
  Sonar: "SonarQube MCP server",
  // identity and secrets
  Okta: "okta/okta-mcp-server, GA",
  Auth0: "auth0/auth0-mcp-server",
  JumpCloud: "JumpCloud MCP server for admins, hosted",
  CyberArk: "CyberArk SCA and Secrets Manager MCP servers",
  "HashiCorp Vault": "hashicorp/vault-mcp-server, experimental",
  "1Password": "1Password MCP server",
  // GRC
  Vanta: "Vanta hosted MCP server, beta",
  Drata: "Drata hosted MCP server",
  ServiceNow: "ServiceNow MCP server",
  Jira: "Atlassian Rovo MCP server",
  Confluence: "Atlassian Rovo MCP server",
  // code and pipeline
  GitHub: "github/github-mcp-server",
  GitLab: "GitLab MCP server",
  Bitbucket: "Atlassian Rovo MCP server (Bitbucket Cloud)",
  CircleCI: "CircleCI hosted MCP server",
  Terraform: "hashicorp/terraform-mcp-server",
  Ansible: "Red Hat Ansible Automation Platform MCP server, GA",
  Docker: "Docker MCP Gateway and catalog",
  // business systems
  Salesforce: "Salesforce MCP server",
  SAP: "SAP MCP servers; Joule connects over MCP",
  Oracle: "Oracle SQLcl and Database Tools MCP servers",
  NetSuite: "NetSuite AI Connector Service (MCP)",
  Xero: "XeroAPI/xero-mcp-server",
  QuickBooks: "intuit/quickbooks-online-mcp-server, early preview",
  Stripe: "Stripe MCP server",
  DocuSign: "Docusign MCP server, GA 30 September 2026",
  // documents and data
  "Google Drive": "Google Workspace MCP server, developer preview",
  Gmail: "Google Workspace MCP server, developer preview",
  Box: "Box MCP server",
  Notion: "Notion MCP server",
  Snowflake: "Snowflake MCP server",
  Databricks: "Databricks managed MCP servers",
  BigQuery: "Google MCP Toolbox for Databases",
  "Google Cloud": "Google-managed MCP servers",
  Redshift: "awslabs/mcp Redshift MCP server",
  "Amazon S3": "awslabs/mcp AWS MCP servers",
  MongoDB: "mongodb/mongodb-mcp-server",
  Kafka: "confluentinc/mcp-confluent, officially supported",
  Fivetran: "fivetran/fivetran-mcp",
  dbt: "dbt-labs/dbt-mcp",
  Tableau: "Tableau MCP server",
  // cloud and devops
  Datadog: "Datadog MCP server, preview",
  Grafana: "grafana/mcp-grafana",
  "New Relic": "New Relic MCP server",
  PagerDuty: "PagerDuty MCP server",
  UiPath: "UiPath platform MCP servers",
  // communication and work
  Slack: "Slack MCP server",
  Zoom: "Zoom MCP server, hosted",
  Webex: "CiscoDevNet/webex-mcp-official",
  Twilio: "Twilio MCP server",
  Intercom: "Intercom MCP server",
  Asana: "Asana MCP server",
  "Monday.com": "monday MCP, hosted",
  Smartsheet: "Smartsheet MCP server, GA",
};

/**
 * Checked on 2026-09-17 and found to have no vendor-published MCP server,
 * so the platform serves them: Microsoft Defender (community servers only),
 * Workday (announced, not launched), Rapid7, SecurityScorecard, Veracode
 * (community only), Zendesk (a marketplace app and an MCP client, not a
 * published server).
 */

function slugOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export const VENDORS: Vendor[] = VENDOR_GROUPS.flatMap((g) =>
  g.items.map((name) => ({
    name,
    group: g.name,
    c: g.c,
    slug: slugOf(name),
    ...(VIA[name] ?? g.via),
    surface: SURFACE_OVERRIDE[name] ?? SURFACE_BY_GROUP[g.name] ?? "api",
    nativeMcp: name in NATIVE_MCP,
    nativeMcpNote: NATIVE_MCP[name] ?? "",
  })),
);

export const VENDOR_BY_NAME = new Map(VENDORS.map((v) => [v.name, v]));

/** How many systems we advertise. The landing page counts from here too. */
export const VENDOR_COUNT = VENDORS.length;
