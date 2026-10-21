/**
 * The statements the console's eval-set door (app/api/evals/route.ts) reads
 * the shared `eval_runs` table with. Since phase L8 the backend's runner
 * writes the table (`POST /api/agents/{id}/evals/run`): a row is written
 * when an eval is accepted and after every case, so a row still `queued` or
 * `running` (or one that `failed`) sits beside the finished ones. A set's
 * headline score is its latest finished eval, so the list skips every row
 * that is not `done`; a set's history lists them all, with their state.
 * tests/l8-logic.test.ts holds each statement to that.
 */

/** Per set, the latest eval that finished: rows still running, queued or failed are skipped. */
export const LATEST_DONE_PER_SET = `SELECT DISTINCT ON (set_id) set_id, passed, total, model, matrix, at, threshold, passed_threshold, by, version
     FROM eval_runs WHERE state = 'done' ORDER BY set_id, at DESC`;

/** One set's history, newest first: every row, with the backend's columns (its state, the threshold and whether it was met, who started it). */
export const SET_HISTORY = `SELECT id, model, digest, passed, total, results, matrix, summary, at, state, threshold, passed_threshold, by, version, finished_at, error
     FROM eval_runs WHERE set_id = $1 ORDER BY at DESC LIMIT 40`;

/**
 * Deleting a set deletes the history the console's own runner wrote before
 * L8, and keeps every row the backend's runner wrote (they name the version
 * they measured, `summary.version_digest`): those are the backend's records,
 * the evidence a production deploy's gate read, and a deployment names its
 * eval by id.
 */
export const DELETE_CONSOLE_HISTORY = `DELETE FROM eval_runs WHERE set_id = $1 AND coalesce(summary->>'version_digest', '') = ''`;
