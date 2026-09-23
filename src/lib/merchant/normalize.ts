import type { MPost } from "./types";

/** Shapes accepted from the engage clients. Fields beyond id are optional so the
 *  mapping survives Graph omitting anything it considers empty. */
export interface IgMediaIn {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  comments_count?: number;
}
export interface IgCommentIn {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  hidden?: boolean;
  replies?: { id: string; text?: string; username?: string; timestamp?: string }[];
}
export interface FbPostIn {
  id: string;
  message?: string;
  permalink_url?: string;
  created_time?: string;
  comments_count?: number;
  full_picture?: string;
}
export interface FbCommentIn {
  id: string;
  message?: string;
  username?: string;
  timestamp?: string;
  hidden?: boolean;
  replies?: { id: string; message?: string; authorId?: string; authorName?: string; created_time?: string }[];
}

/**
 * `selfUsername` identifies the merchant's own replies. Without it nothing is
 * marked as ours, which errs toward showing a comment as unanswered — the safe
 * direction, since the opposite would hide a buyer's question.
 */
export function fromIg(media: IgMediaIn[], comments: Record<string, IgCommentIn[]>, selfUsername?: string): MPost[] {
  return media.map((m) => ({
    platform: "IG",
    id: m.id,
    caption: m.caption ?? "",
    thumbUrl: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
    permalink: m.permalink,
    createdAt: m.timestamp,
    commentCount: m.comments_count ?? 0,
    comments: (comments[m.id] ?? []).map((c) => ({
      platform: "IG",
      id: c.id,
      postId: m.id,
      author: c.username ?? "",
      text: c.text ?? "",
      createdAt: c.timestamp,
      hidden: !!c.hidden,
      replies: (c.replies ?? []).map((r) => ({
        id: r.id,
        author: r.username ?? "",
        text: r.text ?? "",
        createdAt: r.timestamp,
        fromUs: !!selfUsername && r.username === selfUsername,
      })),
    })),
  }));
}

/** Facebook replies are ours only when their author id is the Page id — a
 *  display name can be imitated, an id cannot. */
export function fromFb(posts: FbPostIn[], comments: Record<string, FbCommentIn[]>, pageId?: string): MPost[] {
  return posts.map((p) => ({
    platform: "FB",
    id: p.id,
    caption: p.message ?? "",
    thumbUrl: p.full_picture,
    permalink: p.permalink_url,
    createdAt: p.created_time,
    commentCount: p.comments_count ?? 0,
    comments: (comments[p.id] ?? []).map((c) => ({
      platform: "FB",
      id: c.id,
      postId: p.id,
      author: c.username ?? "",
      text: c.message ?? "",
      createdAt: c.timestamp,
      hidden: !!c.hidden,
      replies: (c.replies ?? []).map((r) => ({
        id: r.id,
        author: r.authorName ?? "",
        text: r.message ?? "",
        createdAt: r.created_time,
        fromUs: !!pageId && r.authorId === pageId,
      })),
    })),
  }));
}
