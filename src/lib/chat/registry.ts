// Which tools a person's chat is offered, and how they are described to the model.

import { zodToJsonSchema } from "zod-to-json-schema";

import type { ChatToolSpec } from "@/lib/ai/chat";
import { can, type Role } from "@/lib/newsroom/roles";
import type { ChatKind, ChatTool, Risk, WriteTool } from "./types";

/** Tool names are unique; a duplicate would make the model's call ambiguous, so it is a programming error. */
export function indexTools(tools: ChatTool[]): Map<string, ChatTool> {
  const map = new Map<string, ChatTool>();
  for (const t of tools) {
    if (map.has(t.name)) throw new Error(`duplicate chat tool: ${t.name}`);
    map.set(t.name, t);
  }
  return map;
}

/** The tools of this kind of workspace that this role may use. The role is checked again when a tool runs. */
export function toolsFor(tools: ChatTool[], kind: ChatKind, role: Role): ChatTool[] {
  return tools.filter((t) => t.kinds.includes(kind) && can(role, t.permission));
}

/** The tool definitions in the OpenAI function format every provider accepts. */
export function toolSpecs(tools: ChatTool[]): ChatToolSpec[] {
  return tools.map((t) => {
    const schema = zodToJsonSchema(t.schema, { $refStrategy: "none", target: "openApi3" }) as Record<string, unknown>;
    delete schema.$schema;
    // Every provider wants an object at the root.
    const parameters = schema.type === "object" ? schema : { type: "object", properties: {} };
    return { type: "function", function: { name: t.name, description: t.description, parameters } };
  });
}

/** The risk of these arguments (some tools are low when they switch something off and standing when they switch it on). */
export function riskOf(tool: WriteTool, args: unknown): Exclude<Risk, "read"> {
  return tool.riskFor?.(args) ?? (tool.risk as Exclude<Risk, "read">);
}
