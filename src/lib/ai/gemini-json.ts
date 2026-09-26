import { getGemini } from "@/lib/gemini";
import type { JsonCall, JsonResult } from "./provider";

const MODEL = "gemini-2.5-flash";

export async function geminiJson({ system, user }: JsonCall, timeoutMs: number): Promise<JsonResult> {
  const res = await getGemini().models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: user }] }],
    config: {
      systemInstruction: system,
      responseMimeType: "application/json",
      // gemini-2.5-flash spends tokens thinking before it answers.
      maxOutputTokens: 4096,
      httpOptions: { timeout: timeoutMs },
    },
  });
  const text = res.text?.trim();
  if (!text) throw new Error("empty reply");
  return { data: JSON.parse(text), model: MODEL };
}
