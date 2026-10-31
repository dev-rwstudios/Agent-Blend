/**
 * Images in messages: how each provider wants them, and downscaling in the browser.
 *
 * Images are kept as data URLs ("data:image/jpeg;base64,…") everywhere in the
 * app (messages are saved with them), and converted to a provider's wire format
 * only at the moment of the request. The format functions are pure (node --test).
 */

export const MAX_IMAGES = 3;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export interface ParsedImage {
  mime: string;
  base64: string;
}

export function parseDataUrl(url: string): ParsedImage | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(url.trim());
  return m ? { mime: m[1].toLowerCase(), base64: m[2] } : null;
}

const valid = (images: string[]): ParsedImage[] => images.map(parseDataUrl).filter((p): p is ParsedImage => p !== null);

/** OpenAI-compatible (OpenAI, LM Studio, OpenRouter, Groq…): content parts. */
export function openAiContent(text: string, images: string[]) {
  const imgs = valid(images);
  if (imgs.length === 0) return text;
  return [
    ...imgs.map((p) => ({ type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.base64}` } })),
    { type: 'text', text },
  ];
}

/** Anthropic: image blocks before the text. */
export function anthropicContent(text: string, images: string[]) {
  const imgs = valid(images);
  if (imgs.length === 0) return text;
  return [
    ...imgs.map((p) => ({ type: 'image', source: { type: 'base64', media_type: p.mime, data: p.base64 } })),
    { type: 'text', text },
  ];
}

/** Gemini: inlineData parts. */
export function geminiParts(text: string, images: string[]) {
  return [...valid(images).map((p) => ({ inlineData: { mimeType: p.mime, data: p.base64 } })), { text }];
}

/** Ollama: bare base64 strings in an `images` array. */
export function ollamaImages(images: string[]): string[] {
  return valid(images).map((p) => p.base64);
}

/** Does an error from a server mean "this model can't take images"? */
export function isNoVisionError(message: string): boolean {
  return /image|vision|multimodal|modalit|mmproj|visual/i.test(message);
}

export const NO_VISION_HELP =
  "This model can't read images. In Settings, set a Vision model (for example a Qwen-VL, LLaVA, Gemma or Llama-vision model loaded in LM Studio, or a hosted model like Claude or GPT-4o) — it is only used for pictures.";

/**
 * Browser only: read an image file and return a downscaled JPEG data URL
 * (longest side `maxSide`), so saved chats and requests stay small.
 */
export async function fileToDataUrl(file: File, maxSide = 1024, quality = 0.85): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(`"${file.name}" is not an image.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`"${file.name}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image.');
  ctx.fillStyle = '#ffffff'; // flatten transparency so JPEG doesn't turn it black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
