"use client";

import { useCallback, useState } from "react";
import { Button, Mono, Tag } from "./ui";
import { BrandMark } from "./brand";
import { CAT } from "./charts";

/* ═══════════════════ Per-cloud shape ═══════════════════ */

interface Cloud {
  key: string;
  brand: string;
  boundary: string;
  network: string;
  runtime: string;
  runtimeNote: string;
  model: string;
  modelNote: string;
  store: string;
  identity: string;
  egress: string;
  tf: string;
  region: string;
}

const CLOUDS: Cloud[] = [
  {
    key: "AWS",
    brand: "Amazon S3",
    boundary: "Your AWS account",
    network: "VPC · private subnets",
    runtime: "ECS Fargate",
    runtimeNote: "harness containers",
    model: "Amazon Bedrock",
    modelNote: "via VPC endpoint",
    store: "S3 + KMS",
    identity: "IAM roles",
    egress: "VPC endpoints, no internet gateway",
    region: "eu-west-2",
    tf: `module "agent_factory" {
  source  = "ey/agent-factory/aws"
  version = "2.4.0"

  region          = "eu-west-2"
  vpc_id          = var.vpc_id
  private_subnets = var.private_subnets

  runtime         = "fargate"
  model_provider  = "bedrock"
  egress          = "vpc_endpoints"

  workflows       = ["dlp-triage", "nist-audit"]
  audit_sink      = aws_s3_bucket.audit.arn
  kms_key_arn     = aws_kms_key.agents.arn
}`,
  },
  {
    key: "Azure",
    brand: "Azure Blob",
    boundary: "Your Azure subscription",
    network: "VNet · private subnets",
    runtime: "Container Apps",
    runtimeNote: "harness containers",
    model: "Microsoft Foundry",
    modelNote: "Azure OpenAI models · private endpoint",
    store: "Blob + Key Vault",
    identity: "Entra ID workload identity",
    egress: "Private endpoints, no public route",
    region: "uksouth",
    tf: `module "agent_factory" {
  source  = "ey/agent-factory/azurerm"
  version = "2.4.0"

  location            = "uksouth"
  resource_group_name = var.rg_name
  subnet_id           = var.private_subnet_id

  runtime         = "container_apps"
  model_provider  = "foundry"
  egress          = "private_endpoints"

  workflows       = ["dlp-triage", "nist-audit"]
  audit_sink      = azurerm_storage_account.audit.id
  key_vault_id    = azurerm_key_vault.agents.id
}`,
  },
  {
    key: "Google Cloud",
    brand: "Google Cloud",
    boundary: "Your GCP project",
    network: "VPC · private service connect",
    runtime: "Cloud Run",
    runtimeNote: "harness containers",
    model: "Vertex AI",
    modelNote: "via PSC endpoint",
    store: "GCS + Cloud KMS",
    identity: "Workload Identity",
    egress: "Private Service Connect, no egress NAT",
    region: "europe-west2",
    tf: `module "agent_factory" {
  source  = "ey/agent-factory/google"
  version = "2.4.0"

  region  = "europe-west2"
  project = var.project_id
  network = var.vpc_network

  runtime         = "cloud_run"
  model_provider  = "vertex"
  egress          = "private_service_connect"

  workflows       = ["dlp-triage", "nist-audit"]
  audit_sink      = google_storage_bucket.audit.name
  kms_key         = google_kms_crypto_key.agents.id
}`,
  },
];

/* ═══════════════════ Topology ═══════════════════ */

/** A box is a kind of thing, not a state — so its marker is categorical,
    never a semantic hue, and the surface behind the text stays neutral. */
function Box({
  label,
  note,
  cat,
  brand,
}: {
  label: string;
  note?: string;
  /** Index into the categorical palette; omit for an unmarked box. */
  cat?: number;
  brand?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-center gap-1 rounded-md border border-line bg-surface px-2.5 py-2 lg:px-3.5 lg:py-3">
      <div className="flex items-center gap-1.5">
        {cat !== undefined && (
          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: CAT[cat % CAT.length] }} aria-hidden />
        )}
        {brand && <BrandMark name={brand} size={12} />}
        <span className="truncate text-[11.5px] font-medium lg:text-[13px]">{label}</span>
      </div>
      {note && <span className="truncate text-[10px] text-faint lg:text-[11px]">{note}</span>}
    </div>
  );
}

function Topology({ c }: { c: Cloud }) {
  return (
    <div className="flex h-full flex-col gap-3">
      {/* Everything inside this frame is the client's own tenancy. */}
      <div className="relative flex grow flex-col rounded-lg border-2 border-dashed border-line-strong p-3 pt-7 lg:p-4 lg:pt-8">
        <span className="absolute top-2 left-3 flex items-center gap-1.5">
          <BrandMark name={c.brand} size={12} />
          <Mono className="text-[10px] text-dim">{c.boundary}</Mono>
          <Mono className="text-[10px] text-ghost">· {c.region}</Mono>
        </span>

        <div className="flex grow flex-col gap-2.5 rounded-md border border-line bg-raise p-2.5 lg:gap-3.5 lg:p-3.5">
          <Mono className="text-[9.5px] text-faint">{c.network}</Mono>

          <div className="grid grow auto-rows-fr grid-cols-2 items-stretch gap-2 sm:grid-cols-4 lg:gap-3">
            <Box label={c.runtime} note={c.runtimeNote} cat={0} />
            <Box label={c.model} note={c.modelNote} cat={1} />
            <Box label={c.store} note="audit records and artifacts" cat={2} />
            <Box label={c.identity} note="static keys not required" cat={3} />
          </div>

          <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ok">
              <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
            </svg>
            <span className="truncate text-[10.5px] text-dim">{c.egress}</span>
          </div>
        </div>
      </div>

      {/* Outside the boundary, deliberately little. */}
      <div className="flex items-center gap-2 px-1">
        <span className="h-px grow bg-line" />
        <Mono className="shrink-0 text-[9.5px] text-ghost">external to your tenancy</Mono>
        <span className="h-px grow bg-line" />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Box label="Agent Factory control plane" note="workflow definitions and release metadata only" />
        <Box label="Your systems of record" note="accessed through declared connectors" />
      </div>

      <p className="px-1 text-[11px] leading-[1.55] text-faint">
        Alert evidence, extracted fields and dispositions remain within the defined
        boundary. Agent Factory provides the workflow definitions; execution occurs in your account.
      </p>
    </div>
  );
}

/* ═══════════════════ Section ═══════════════════ */

export function DeployPanel() {
  const [i, setI] = useState(0);
  const [tab, setTab] = useState<"topology" | "terraform">("topology");
  const [copied, setCopied] = useState(false);
  const c = CLOUDS[i];

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(c.tf).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => setCopied(false),
    );
  }, [c.tf]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 lg:min-h-[560px]">
      <div className="flex grow flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise px-3 py-2">
          <div className="flex gap-1">
            {CLOUDS.map((x, n) => (
              <button
                key={x.key}
                type="button"
                onClick={() => setI(n)}
                aria-pressed={i === n}
                className={`focusable flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 text-[11.5px] transition-colors ${
                  i === n
                    ? "bg-ink font-semibold text-on-ink"
                    : "border border-line font-medium text-faint hover:text-dim"
                }`}
              >
                <BrandMark name={x.brand} size={11} mono={i === n} />
                {x.key}
              </button>
            ))}
          </div>

          <div className="grow" />

          <div className="flex items-center gap-1 rounded-md border border-line bg-raise p-px">
            {(["topology", "terraform"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`focusable cursor-pointer rounded-sm px-2 py-1 text-[11.5px] capitalize transition-colors ${
                  tab === t
                    ? "bg-surface font-semibold text-fg shadow-[var(--shadow-1)]"
                    : "font-medium text-faint hover:text-dim"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === "terraform" && (
            <Button size="sm" variant="quiet" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}
        </div>

        <div key={`${i}-${tab}`} className="af-swap">
          {tab === "topology" ? (
            <div className="p-3.5">
              <Topology c={c} />
            </div>
          ) : (
            <pre className="overflow-x-auto bg-sunken p-4 font-mono text-[11.5px] leading-[1.65] text-mist">
              {c.tf}
            </pre>
          )}
        </div>
      </div>

      {/* The operating considerations associated with this deployment pattern. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          ["Deployment boundary", "organization-controlled cloud environment", "bg-ok"],
          ["Infrastructure review", "aligned to approved cloud controls", "bg-ok"],
          ["Operational readiness", "validated before workflow release", "bg-run"],
        ].map(([step, time, dot]) => (
          <div
            key={step}
            className="flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-2"
          >
            <span className={`size-1.5 shrink-0 rounded-[2px] ${dot}`} />
            <div className="flex min-w-0 grow flex-col">
              <Mono className="truncate text-[11px] text-mist">{step}</Mono>
              <span className="text-[10.5px] text-faint">{time}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tag>Illustrative reference architecture</Tag>
        <Tag>Infrastructure as code</Tag>
        <Tag>Deployment tailored to the environment</Tag>
      </div>
    </div>
  );
}
