// The news desk's write tools (see docs/chat-first/DESIGN.md and the newsroom chat survey). Built in three files by theme:
//   writes-news-story.ts     fetching, drafting, editing, the card, publishing, scheduling, dismissing, video of a story
//   writes-news-settings.ts  the autopilot, the filter, keywords, categories, options, sources and feeds
//   writes-news-brand.ts     automatic video, the writing style, the card look, the photo library and the frames by section
// Four more tools are shared with the shop and live in writes-new.ts, widened to both kinds: hide_comment, reply_to_comment,
// send_message and cancel_scheduled_post.
//
// Not here, and never to be added by a model's output: plans and payments, the team and its invitations, connecting or disconnecting
// accounts, tokens and passwords, recording or deleting the desk's own voice, deleting library photos and clips, and creating or
// deleting a desk.

import type { WriteTool } from "../types";
import { BRAND_TOOLS } from "./writes-news-brand";
import { SETTINGS_TOOLS } from "./writes-news-settings";
import { STORY_TOOLS } from "./writes-news-story";

export const NEWS_WRITE_TOOLS: WriteTool[] = [...STORY_TOOLS, ...SETTINGS_TOOLS, ...BRAND_TOOLS];
