/** What a failed Graph call means for the outbox. */
export type MetaFailure = "token" | "rate" | "window" | "gone" | "duplicate" | "other";

export const MAX_ATTEMPTS = 5;

export function classifyMetaError(status: number, body: unknown): MetaFailure {
  const e = ((body ?? {}) as { error?: { code?: number; error_subcode?: number; message?: string } }).error ?? {};
  const msg = (e.message ?? "").toLowerCase();
  if (e.code === 190 || status === 401) return "token";
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || status === 429) return "rate";
  if (e.code === 10900 || /already (been )?replied|only one/.test(msg)) return "duplicate";
  if (e.error_subcode === 2534022 || e.error_subcode === 2018278 || /allowed window|24 hour|outside of/.test(msg) || e.code === 10) return "window";
  if (e.error_subcode === 33 || /does not exist|cannot be loaded|unsupported (get|post) request/.test(msg)) return "gone";
  return "other";
}

export function retryable(f: MetaFailure): boolean {
  return f === "rate" || f === "other";
}

/** 2, 4, 8 … minutes, capped at an hour. */
export function backoffMs(attempt: number): number {
  return Math.min(3_600_000, 60_000 * 2 ** attempt);
}
