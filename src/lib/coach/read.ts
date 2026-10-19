// Reading the weekly note for the owner: the chat tool and the Today card both come here.
//
// The note is stored once, in one language (the AI wording is written in the owner's profile language). The owner may read the app in
// another language, so a note whose stored language is not the reader's is shown as the rules' text rebuilt from the stored facts in the
// reader's language, and says so (it is no longer the AI's wording). With no note yet, a rules-only reading is made on the spot and
// marked as a preview: nothing is stored and no model is called.

import { db } from "@/lib/db";
import { collectFacts, type CoachFacts, type NoteLang } from "./facts";
import { labelFor, renderRules, type NoteBody, type StoredBody } from "./text";

export interface ReadNote {
  week: string;
  /** What the text shown is: the AI's wording, or the rules' own sentences. */
  source: "ai" | "rules";
  /** ISO time the note was made (null for a preview). */
  madeAt: string | null;
  /** Made now for the reader, not the stored weekly note. */
  preview: boolean;
  body: NoteBody;
  facts: CoachFacts;
  /** The label line that goes with this text. */
  label: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A stored facts column, accepted only if it has the shape the code wrote. */
export function asFacts(v: unknown): CoachFacts | null {
  if (!isObj(v) || v.v !== 1 || typeof v.week !== "string" || !isObj(v.orders) || !isObj(v.messages) || !isObj(v.posts) || !isObj(v.buyers) || !Array.isArray(v.interest)) return null;
  return v as unknown as CoachFacts;
}

/** A stored body column, accepted only if it has the shape the code wrote. */
export function asStoredBody(v: unknown): StoredBody | null {
  if (!isObj(v) || typeof v.headline !== "string" || !Array.isArray(v.points) || !Array.isArray(v.tryThis)) return null;
  if (v.lang !== "ckb" && v.lang !== "ar" && v.lang !== "en") return null;
  const points = v.points.filter((p): p is { key: string; text: string } => isObj(p) && typeof p.key === "string" && typeof p.text === "string");
  const tryThis = v.tryThis.filter((t): t is string => typeof t === "string");
  return { lang: v.lang, headline: v.headline, points, tryThis };
}

/**
 * The newest note of the workspace in the reader's language. With none (and `preview` true) a rules-only reading of this moment.
 * Throws when the database cannot be read: the caller decides what to tell the person.
 */
export async function latestNote(tenantId: string, lang: NoteLang, opts: { preview?: boolean; now?: number } = {}): Promise<ReadNote | null> {
  const row = await db.coachNote.findFirst({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  const facts = row ? asFacts(row.facts) : null;
  if (row && facts) {
    const stored = asStoredBody(row.body);
    const aiShown = row.source === "ai" && stored !== null && stored.lang === lang;
    const body: NoteBody = aiShown && stored ? { headline: stored.headline, points: stored.points, tryThis: stored.tryThis } : renderRules(facts, lang);
    const source = aiShown ? "ai" : "rules";
    return { week: row.week, source, madeAt: row.createdAt.toISOString(), preview: false, body, facts, label: labelFor(source, lang) };
  }
  if (!opts.preview) return null;
  const now = opts.now ?? Date.now();
  const fresh = await collectFacts(tenantId, now);
  return { week: fresh.week, source: "rules", madeAt: null, preview: true, body: renderRules(fresh, lang), facts: fresh, label: labelFor("rules", lang) };
}
