/** The merchant app's view of posts and comments, the same shape for both platforms. */

export type Platform = "FB" | "IG";
export type CommentState = "unanswered" | "answered" | "hidden";

export interface MReply {
  id: string;
  author: string;
  text: string;
  createdAt?: string;
  /** Written by the merchant's own Page or account. */
  fromUs: boolean;
}

export interface MComment {
  platform: Platform;
  id: string;
  postId: string;
  author: string;
  text: string;
  createdAt?: string;
  hidden: boolean;
  replies: MReply[];
}

export interface MPost {
  platform: Platform;
  id: string;
  caption: string;
  thumbUrl?: string;
  permalink?: string;
  createdAt?: string;
  commentCount: number;
  comments: MComment[];
}

export interface MMessage {
  id: string;
  text: string;
  fromUs: boolean;
  createdAt?: string;
}

export interface MConversation {
  platform: Platform;
  id: string;
  participantId?: string;
  participantName?: string;
  messages: MMessage[];
  /** Meta only lets a business answer within 24 hours of the customer's last message. */
  withinWindow: boolean;
  updatedAt?: string;
}
