"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DOORS, ask, type Answer, type Door, type DoorId } from "@/lib/api/pending";
import { notBuiltDoorOf } from "@/lib/api/client";

/**
 * A screen whose address the platform has not built yet (lib/api/pending.ts).
 *
 * `useDoor` asks once and again on `reload`; `NotConnected` is what a panel
 * shows when the platform answers 501 "not built": what the panel is for,
 * that the platform does not do it yet, and the address it would call. It is
 * never a stand-in record.
 */

export function useDoor<T>(
  id: DoorId,
  opts: { params?: Record<string, string>; query?: Record<string, string | number | undefined>; skip?: boolean } = {},
): { answer: Answer<T> | null; reload: () => void } {
  const [answer, setAnswer] = useState<Answer<T> | null>(null);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([opts.params ?? {}, opts.query ?? {}]);
  useEffect(() => {
    if (opts.skip) return;
    let live = true;
    const [params, query] = JSON.parse(key) as [Record<string, string>, Record<string, string | number | undefined>];
    ask<T>(id, { params, query }).then((a) => {
      if (live) setAnswer(a);
    });
    return () => {
      live = false;
    };
  }, [id, key, tick, opts.skip]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { answer, reload };
}

/** An address read back from a "not built" message (lib/api/client.ts notBuiltText): no purpose is known for it, only where it is. */
export interface NamedDoor {
  method: string;
  path: string;
  purpose?: string;
}

const doorOf = (door: DoorId | Door | NamedDoor): NamedDoor => (typeof door === "string" ? DOORS[door] : door);

/** What a panel shows while its door is not there. `door` is an id, the door itself (from a pending answer), or an address read from a message. */
export function NotConnected({ door, title, children, compact = false }: { door: DoorId | Door | NamedDoor; title?: string; children?: ReactNode; compact?: boolean }) {
  const d = doorOf(door);
  const purpose = children ?? (d.purpose ? `${d.purpose}.` : null);
  return (
    <div className={`flex flex-col gap-1.5 rounded-lg border border-dashed border-line-strong bg-surface ${compact ? "px-4 py-3" : "px-6 py-8"}`} data-pending={d.path}>
      <span className="flex items-center gap-2">
        <span className="size-1.5 shrink-0 rounded-[2px] bg-faint" />
        <span className="text-[13px] font-semibold text-fg">{title ?? "Not built yet"}</span>
      </span>
      {purpose && <p className="max-w-[64ch] text-[12.5px] leading-[1.55] text-dim">{purpose}</p>}
      <p className="text-[11.5px] leading-[1.5] text-faint">
        The platform answers{" "}
        <span className="font-mono text-[11px] text-dim">
          {d.method ? `${d.method} ` : ""}
          {d.path}
        </span>{" "}
        with 501, not built. Nothing here is shown until it does.
      </p>
    </div>
  );
}

/** One line for a form or a field whose door is not there. */
export function NotConnectedNote({ door }: { door: DoorId | Door | NamedDoor }) {
  const d = doorOf(door);
  return (
    <span className="text-[11.5px] leading-[1.5] text-faint" data-pending={d.path}>
      Not built yet: the platform answers 501 to{" "}
      <span className="font-mono text-[11px] text-dim">
        {d.method ? `${d.method} ` : ""}
        {d.path}
      </span>
      .
    </span>
  );
}

/**
 * A value the platform names in its answer's `not_built` list (lib/not-built.ts):
 * the field is there with an empty value because its feature is not built, so
 * it reads "not built", never "none" or a zero. `field` is the answer's own
 * name for it, shown on hover.
 */
export function NotBuiltValue({ field, className = "" }: { field: string; className?: string }) {
  return (
    <span className={`text-[11.5px] text-faint ${className}`} title={`The platform names ${field} as not built: its value is empty because nothing produces it yet.`} data-not-built={field}>
      not built
    </span>
  );
}

/**
 * A read or a write that failed, as a person should see it. A "not built"
 * answer (a message from lib/api/client.ts notBuiltText) is drawn as the
 * not-built panel or note, naming the method, the address and the 501;
 * anything else is drawn as a failure, in red, with the message, which names
 * the status and the address. `what` leads the failure: "The runs could not
 * be read".
 */
export function Failure({ message, what, inline = false, compact = true, className = "" }: { message: string; what?: string; inline?: boolean; compact?: boolean; className?: string }) {
  const door = notBuiltDoorOf(message);
  if (door) {
    if (inline) return <NotConnectedNote door={door} />;
    return (
      <div className={className}>
        <NotConnected door={door} compact={compact} />
      </div>
    );
  }
  const text = what ? `${what}: ${message}` : message;
  if (inline) return <span className={`text-[11.5px] leading-[1.5] text-err ${className}`} role="alert">{text}</span>;
  return (
    <p className={`rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err ${className}`} role="alert">
      {text}
    </p>
  );
}

/** The same for an `ask()` answer that is not `ok`: the not-built panel for a pending door, the failure for an error. */
export function AnswerFailure({ answer, what, inline = false, compact = true, className = "" }: { answer: Answer<unknown>; what?: string; inline?: boolean; compact?: boolean; className?: string }) {
  if (answer.state === "ok") return null;
  if (answer.state === "pending") {
    if (inline) return <NotConnectedNote door={answer.door} />;
    return (
      <div className={className}>
        <NotConnected door={answer.door} compact={compact} />
      </div>
    );
  }
  return <Failure message={answer.message} what={what} inline={inline} compact={compact} className={className} />;
}
