"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { PageHeader } from "./section";
import { Skeleton } from "./loaders";
import { QUIET } from "@/lib/quiet";
import { WINDOWS, type Win } from "./window-pick";
import { Card, ErrorLine, WindowBar, narrowestWindow, useLedger } from "./observability-shared";
import { VIEWS, ViewSwitch, useAddress, type Address, type ViewId } from "./explore-parts";
import { ToolCallsView } from "./explore-tools";
import { AgentActivityView } from "./explore-activity";
import { SecurityEventsView } from "./explore-security";

/**
 * Explore: one place to filter and read everything the platform recorded.
 *
 * A view is the kind of record being read: tool calls, what each agent did,
 * or what the controls did. Each view reads the same doors its own page read
 * before (components/observability-shared.tsx): the run ledger and a bounded
 * number of run journals. The page holds what the views share (the window,
 * the ledger, the re-read) and keeps every choice in the address:
 * `?view=`, `?window=`, a view's filters, the search (`q`) and the span
 * dragged on the timeline (`from`, `to`).
 */

export interface ViewProps {
  ledger: ReturnType<typeof useLedger>;
  win: Win;
  now: number;
  address: Address;
  /** Moves each time "Read again" is pressed, for a view that reads doors of its own. */
  tick: number;
  /** A view that reads doors of its own says while it is reading. */
  onBusy: (busy: boolean) => void;
}

function Explore() {
  const address = useAddress();
  const [now] = useState(() => Date.now());
  const ledger = useLedger();
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const view: ViewId = VIEWS.find((v) => v.id === address.one("view"))?.id ?? "tools";
  const asked = WINDOWS.find((w) => w.id === address.one("window"))?.id ?? null;
  const fitted = useMemo(() => narrowestWindow(ledger.rows ?? [], now), [ledger.rows, now]);
  const win = asked ?? fitted;
  const auto = asked === null && ledger.rows !== null && ledger.rows.length > 0;

  const { reload: reloadLedger } = ledger;
  const reload = useCallback(() => {
    reloadLedger();
    setTick((t) => t + 1);
  }, [reloadLedger]);

  const props: ViewProps = { ledger, win, now, address, tick, onBusy: setBusy };
  // Tool calls and agent activity are read from the run ledger: without it there is nothing to cut.
  const onLedger = view !== "security";
  const down = onLedger && Boolean(ledger.error) && !ledger.rows;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader title="Explore" action={<WindowBar win={win} auto={auto} onPick={address.window} onReload={reload} loading={ledger.loading || (view === "security" && busy)} />}>
        Filter and read everything the platform recorded.
      </PageHeader>

      <ViewSwitch value={view} onChange={address.go} />

      {onLedger && ledger.error && <ErrorLine what="The run ledger did not answer" message={ledger.error} />}

      {onLedger && !ledger.rows && !ledger.error && (
        <Card title={VIEWS.find((v) => v.id === view)!.label} hue={view === "tools" ? "tool" : "agent"} meta="reading the run ledger…">
          <div className="p-4">
            <Skeleton lines={4} />
          </div>
        </Card>
      )}

      {view === "tools" && ledger.rows && <ToolCallsView key="tools" {...props} rows={ledger.rows} />}
      {/* A quiet console whose ledger did not answer has said so once; with the ledger's reason shown, the agents on the registry are still worth listing. */}
      {view === "activity" && (ledger.rows || (down && !QUIET)) && <AgentActivityView key="activity" {...props} />}
      {view === "security" && <SecurityEventsView key="security" {...props} />}
    </div>
  );
}

export function ExploreView() {
  return (
    <Suspense>
      <Explore />
    </Suspense>
  );
}
