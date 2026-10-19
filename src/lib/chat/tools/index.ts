// Every tool the chat has. The two lists are built in their own files; this is the only place that joins them.

import type { ChatTool } from "../types";
import { READ_TOOLS } from "./reads";
import { WRITE_TOOLS } from "./writes";

export const ALL_TOOLS: ChatTool[] = [...READ_TOOLS, ...WRITE_TOOLS];
