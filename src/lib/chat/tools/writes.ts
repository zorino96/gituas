// The chat's write tools: everything that changes something. A model only ever PROPOSES one of these; the card shows the exact
// values, and the change runs only when the person confirms it (or the autonomy setting allows it for a low-risk change).
//
// Not here, and never to be added by a model's output: plans and payments, connecting or disconnecting accounts, tokens and
// keys, passwords, and deleting data. (A hidden comment is not a deleted one; a cancelled scheduled post is not a deleted post.)

import type { WriteTool } from "@/lib/chat/types";
import { NEW_WRITE_TOOLS } from "./writes-new";
import { SHOP_WRITE_TOOLS } from "./writes-shop";

export const WRITE_TOOLS: WriteTool[] = [...SHOP_WRITE_TOOLS, ...NEW_WRITE_TOOLS];
