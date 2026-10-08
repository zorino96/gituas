export type MetaPlatform = "META_FACEBOOK" | "META_INSTAGRAM";
/** Where the shop answers: Meta comments/DMs, plus WhatsApp DMs (src/lib/whatsapp). */
export type ShopPlatform = MetaPlatform | "WHATSAPP";

export type ShopEvent =
  | {
      kind: "comment";
      platform: MetaPlatform;
      accountId: string;
      commentId: string;
      postId: string;
      parentCommentId: string | null;
      authorId: string | null;
      authorName: string | null;
      text: string;
    }
  | { kind: "dm"; platform: MetaPlatform; accountId: string; messageId: string; senderId: string; text: string };

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * One webhook entry → the events the shop acts on. Only new comments (Facebook
 * `feed` with verb "add", Instagram `comments`) and inbound DMs; edits,
 * removals, reactions, echoes and our own messages are dropped here.
 */
export function parseEntry(object: string | undefined, entry: unknown): ShopEvent[] {
  const e = (entry ?? {}) as Obj;
  const accountId = str(e.id);
  if (!accountId) return [];
  if (object !== "page" && object !== "instagram") return [];
  const platform: MetaPlatform = object === "page" ? "META_FACEBOOK" : "META_INSTAGRAM";
  const out: ShopEvent[] = [];

  for (const change of Array.isArray(e.changes) ? (e.changes as Obj[]) : []) {
    const v = (change?.value ?? {}) as Obj;
    const from = (v.from ?? {}) as Obj;
    if (platform === "META_FACEBOOK") {
      if (change.field !== "feed" || v.item !== "comment" || v.verb !== "add") continue;
      const commentId = str(v.comment_id);
      const postId = str(v.post_id);
      if (!commentId || !postId) continue;
      const parent = str(v.parent_id);
      out.push({
        kind: "comment", platform, accountId, commentId, postId,
        parentCommentId: parent && parent !== postId ? parent : null,
        authorId: str(from.id), authorName: str(from.name), text: text(v.message),
      });
    } else {
      if (change.field !== "comments") continue;
      const commentId = str(v.id);
      const postId = str(((v.media ?? {}) as Obj).id);
      if (!commentId || !postId) continue;
      out.push({
        kind: "comment", platform, accountId, commentId, postId,
        parentCommentId: str(v.parent_id),
        authorId: str(from.id), authorName: str(from.username), text: text(v.text),
      });
    }
  }

  for (const m of Array.isArray(e.messaging) ? (e.messaging as Obj[]) : []) {
    const msg = (m?.message ?? {}) as Obj;
    const senderId = str(((m?.sender ?? {}) as Obj).id);
    const messageId = str(msg.mid);
    if (!messageId || !senderId || msg.is_echo === true || senderId === accountId) continue;
    out.push({ kind: "dm", platform, accountId, messageId, senderId, text: text(msg.text) });
  }
  return out;
}
