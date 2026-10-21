/**
 * Server-sent events, parsed by hand.
 *
 * The browser's EventSource does this itself; this parser exists for the
 * places that read the same stream from a Response body (a server-side
 * consumer, a test over a recorded sample) and as the one written-down
 * statement of the wire format the backend emits:
 *
 *   event: entry\n
 *   data: {...one journal entry...}\n
 *   \n
 *   : keepalive\n          (a comment, every 15 s of silence)
 *   \n
 *   event: end\n
 *   data: {"state": ..., "error": ..., "result": ..., "suspension": ...}\n
 *   \n
 *
 * Frames end at a blank line. A frame may spread `data:` over several lines
 * (joined with "\n"); a line starting with ":" is a comment; an unknown
 * field is ignored, as the spec says.
 */

export interface SseEvent {
  /** The `event:` field, or "message" when the frame named none. */
  event: string;
  data: string;
  id?: string;
}

/** Feed chunks as they arrive; frames complete across chunk boundaries. */
export class SseParser {
  private buffered = "";

  feed(chunk: string): SseEvent[] {
    this.buffered += chunk;
    const out: SseEvent[] = [];
    for (;;) {
      // A frame ends at the first blank line; both newline conventions count.
      const m = /\r?\n\r?\n/.exec(this.buffered);
      if (!m) break;
      const frame = this.buffered.slice(0, m.index);
      this.buffered = this.buffered.slice(m.index + m[0].length);
      const ev = frameToEvent(frame);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** What a stream that closed without a final blank line still held. */
  end(): SseEvent[] {
    const rest = this.buffered;
    this.buffered = "";
    const ev = rest.trim() ? frameToEvent(rest) : null;
    return ev ? [ev] : [];
  }
}

export function parseSse(text: string): SseEvent[] {
  const p = new SseParser();
  return [...p.feed(text), ...p.end()];
}

function frameToEvent(frame: string): SseEvent | null {
  let event = "";
  let id: string | undefined;
  const data: string[] = [];
  for (const raw of frame.split(/\r?\n/)) {
    if (!raw || raw.startsWith(":")) continue;
    const colon = raw.indexOf(":");
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? "" : raw.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  // A frame with no data is a comment or a bare `event:` line — not dispatched.
  if (!data.length) return null;
  return { event: event || "message", data: data.join("\n"), ...(id !== undefined ? { id } : {}) };
}
