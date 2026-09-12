import { GoogleGenAI } from '@google/genai';
let client;
export function gemini() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY non impostata (vedi docs/SETUP.md)');
  return (client ||= new GoogleGenAI({ apiKey }));
}
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-pro';
export const TTS_MODELS = (process.env.GEMINI_TTS_MODEL ? [process.env.GEMINI_TTS_MODEL] : []).concat(['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts']);
export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
