// Every tool the chat has. The lists are built in their own files; this is the only place that joins them.

import type { ChatTool } from "../types";
import { READ_TOOLS } from "./reads";
import { COACH_TOOLS } from "./reads-coach";
import { NEWS_READ_TOOLS } from "./reads-news";
import { PICTURE_TOOLS } from "./reads-picture";
import { WRITE_TOOLS } from "./writes";
import { NEWS_WRITE_TOOLS } from "./writes-news";

export const ALL_TOOLS: ChatTool[] = [...READ_TOOLS, ...PICTURE_TOOLS, ...COACH_TOOLS, ...WRITE_TOOLS, ...NEWS_READ_TOOLS, ...NEWS_WRITE_TOOLS];
