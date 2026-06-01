import { GoogleGenAI } from "@google/genai";

export function isGeminiConfigured(): boolean {
  return !!process.env.GOOGLE_AI_API_KEY && process.env.GOOGLE_AI_API_KEY.length > 0;
}

let cached: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!isGeminiConfigured()) {
    throw new Error("GOOGLE_AI_API_KEY is not configured");
  }
  if (!cached) {
    cached = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! });
  }
  return cached;
}
