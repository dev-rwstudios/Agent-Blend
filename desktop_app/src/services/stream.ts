/**
 * Parsers for the streaming formats LLM servers use, so the UI can show the
 * model's thinking as it is written.
 *
 * - OpenAI-compatible (OpenAI, LM Studio, OpenRouter, Groq, …): SSE lines
 *   `data: {...}` ending with `data: [DONE]`. Reasoning models add
 *   `reasoning_content` (LM Studio / DeepSeek) or `reasoning` (OpenRouter).
 * - Ollama: newline-delimited JSON, `message.content`, optional `message.thinking`.
 * - Anthropic: SSE `content_block_delta` events (`text_delta`, `thinking_delta`).
 *
 * Pure module (node --test).
 */

export interface Delta {
  text?: string;
  reasoning?: string;
}

export type ParsedLine = Delta | 'done' | null;

/** Splits a text stream into lines, holding a trailing partial line until the next chunk. */
export class LineSplitter {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.map((l) => l.replace(/\r$/, ''));
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest ? [rest] : [];
  }
}

function errorText(payload: any): string | null {
  const e = payload?.error;
  if (!e) return null;
  return typeof e === 'string' ? e : e.message || JSON.stringify(e);
}

function sseData(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  return line.slice(5).trim();
}

export function parseOpenAiLine(line: string): ParsedLine {
  const data = sseData(line);
  if (data === null || data === '') return null;
  if (data === '[DONE]') return 'done';
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const err = errorText(json);
  if (err) throw new Error(err);
  const delta = json?.choices?.[0]?.delta;
  if (!delta) return null;
  const text = typeof delta.content === 'string' ? delta.content : '';
  const reasoning = [delta.reasoning_content, delta.reasoning].find((r) => typeof r === 'string' && r) ?? '';
  return text || reasoning ? { text: text || undefined, reasoning: reasoning || undefined } : null;
}

export function parseOllamaLine(line: string): ParsedLine {
  if (!line.trim()) return null;
  let json: any;
  try {
    json = JSON.parse(line);
  } catch {
    return null;
  }
  const err = errorText(json);
  if (err) throw new Error(err);
  const text = typeof json?.message?.content === 'string' ? json.message.content : '';
  const reasoning = typeof json?.message?.thinking === 'string' ? json.message.thinking : '';
  if (json?.done && !text && !reasoning) return 'done';
  return text || reasoning ? { text: text || undefined, reasoning: reasoning || undefined } : null;
}

export function parseAnthropicLine(line: string): ParsedLine {
  const data = sseData(line);
  if (!data) return null;
  let json: any;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  if (json?.type === 'error') throw new Error(errorText(json) || 'The model reported an error.');
  if (json?.type === 'message_stop') return 'done';
  if (json?.type === 'content_block_delta') {
    if (json.delta?.type === 'text_delta' && json.delta.text) return { text: json.delta.text };
    if (json.delta?.type === 'thinking_delta' && json.delta.thinking) return { reasoning: json.delta.thinking };
  }
  return null;
}

export type StreamKind = 'openai' | 'ollama' | 'anthropic';

const PARSERS: Record<StreamKind, (line: string) => ParsedLine> = {
  openai: parseOpenAiLine,
  ollama: parseOllamaLine,
  anthropic: parseAnthropicLine,
};

/**
 * Read a streaming response to the end, calling `onDelta` for every piece.
 * Returns everything the model wrote (the answer, and separately its reasoning).
 */
export async function readStream(
  body: ReadableStream<Uint8Array>,
  kind: StreamKind,
  onDelta?: (d: Delta) => void
): Promise<{ text: string; reasoning: string }> {
  const parse = PARSERS[kind];
  const splitter = new LineSplitter();
  const decoder = new TextDecoder();
  let text = '';
  let reasoning = '';
  let finished = false;

  const handle = (line: string) => {
    if (finished) return;
    const parsed = parse(line);
    if (parsed === 'done') {
      finished = true;
    } else if (parsed) {
      if (parsed.text) text += parsed.text;
      if (parsed.reasoning) reasoning += parsed.reasoning;
      onDelta?.(parsed);
    }
  };

  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    splitter.push(decoder.decode(value, { stream: true })).forEach(handle);
  }
  splitter.push(decoder.decode()).forEach(handle);
  splitter.flush().forEach(handle);
  return { text, reasoning };
}
