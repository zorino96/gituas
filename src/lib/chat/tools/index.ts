// Every tool the chat has. The lists are built in their own files; this is the only place that joins them.

import type { ChatTool } from "../types";
import { READ_TOOLS } from "./reads";
import { ACCOUNT_READ_TOOLS } from "./reads-accounts";
import { COACH_TOOLS } from "./reads-coach";
import { HEALTH_READ_TOOLS } from "./reads-health";
import { NEWS_READ_TOOLS } from "./reads-news";
import { PICTURE_TOOLS } from "./reads-picture";
import { RULE_READ_TOOLS } from "./reads-rules";
import { WRITE_TOOLS } from "./writes";
import { ACCOUNT_WRITE_TOOLS } from "./writes-accounts";
import { NEWS_WRITE_TOOLS } from "./writes-news";
import { RESET_WRITE_TOOLS } from "./writes-reset";
import { RULE_WRITE_TOOLS } from "./writes-rules";

export const ALL_TOOLS: ChatTool[] = [...READ_TOOLS, ...PICTURE_TOOLS, ...COACH_TOOLS, ...RULE_READ_TOOLS, ...HEALTH_READ_TOOLS, ...ACCOUNT_READ_TOOLS, ...WRITE_TOOLS, ...RULE_WRITE_TOOLS, ...ACCOUNT_WRITE_TOOLS, ...RESET_WRITE_TOOLS, ...NEWS_READ_TOOLS, ...NEWS_WRITE_TOOLS];
