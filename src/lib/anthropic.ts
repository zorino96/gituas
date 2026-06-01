// Anthropic is no longer used for Personality generation (we use Gemini).
// This stub exists so legacy imports keep compiling; isAnthropicConfigured
// reflects whether an Anthropic key happens to be present in the env.
export function isAnthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 0;
}
