/**
 * The fields a saved definition holds that the platform's parser does not
 * read, as the save answered them (`unread` on `POST /api/agents`): an
 * unknown field on a node, a step, an edge or a tool, or a text field given
 * something that is not text. The version is saved as sent and runs as if
 * those fields were not written, so the person who wrote `condition` on an
 * edge (the field is `when`) learns the route is unconditional. Nothing is
 * drawn when there is none.
 */
export function UnreadFields({ unread, className = "" }: { unread: string[]; className?: string }) {
  if (!unread.length) return null;
  return (
    <div role="note" className={`flex flex-col gap-1 rounded-md border border-warn/50 bg-surface px-3 py-2 ${className}`}>
      <span className="text-[12px] font-medium text-warn">
        Saved, but {unread.length === 1 ? "one field is" : `${unread.length} fields are`} not read by the platform: the version runs as if {unread.length === 1 ? "it were" : "they were"} not written.
      </span>
      <ul className="list-disc pl-4 font-mono text-[11px] leading-[1.55] break-words text-dim">
        {unread.map((u, i) => (
          <li key={i}>{u}</li>
        ))}
      </ul>
    </div>
  );
}
