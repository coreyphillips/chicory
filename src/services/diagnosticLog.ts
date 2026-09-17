/**
 * A short in-memory timeline of what the engine and the session reported:
 * peer connections and errors, redials, node errors, and the balance moving
 * from "reconnecting" to a figure that can be sent. The Diagnostics card
 * appends it to its report, so the question "why did the balance take so
 * long to appear" has timestamps to answer it instead of a guess. Nothing
 * here is persisted; it lives as long as the app process does.
 */
export interface DiagnosticEntry {
  /** ISO timestamp of when the event was recorded on this device. */
  at: string;
  phase: string;
  message: string;
  code?: string;
}

const LIMIT = 80;
const MESSAGE_LIMIT = 300;
const entries: DiagnosticEntry[] = [];

export function recordDiagnostic(event: {
  phase: string;
  message: string;
  code?: string;
}): void {
  entries.push({
    at: new Date().toISOString(),
    phase: event.phase,
    message: String(event.message ?? '').slice(0, MESSAGE_LIMIT),
    ...(event.code ? { code: event.code } : {}),
  });
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
}

/** Oldest first. A copy, so a reader cannot edit the log. */
export function recentDiagnostics(): DiagnosticEntry[] {
  return entries.map(entry => ({ ...entry }));
}

export function clearDiagnostics(): void {
  entries.length = 0;
}
