import type { CommentState, MComment, MPost } from "./types";

/** Hidden wins over answered: a hidden comment needs no reply, whatever its thread holds. */
export function commentState(c: MComment): CommentState {
  if (c.hidden) return "hidden";
  return c.replies.some((r) => r.fromUs) ? "answered" : "unanswered";
}

export function countStates(posts: MPost[]): Record<CommentState, number> {
  const n: Record<CommentState, number> = { unanswered: 0, answered: 0, hidden: 0 };
  for (const p of posts) for (const c of p.comments) n[commentState(c)]++;
  return n;
}

/** Posts that drew the most comments first; newer first on a tie. */
export function rankPosts(posts: MPost[], n = 5): MPost[] {
  return [...posts]
    .sort((a, b) => b.commentCount - a.commentCount || (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, n);
}
