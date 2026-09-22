import { withLlmSlot } from "@cortex/shared";
import { type EmbeddingProvider } from "./provider.js";
import { reportEmbeddingUsage } from "./usage-sink.js";

/** The slot is held by the caller (`embed`), so retries do NOT release the budget:
 *  retrying is part of the same call. */
async function postWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
  const max = 6;
  for (let attempt = 0; attempt < max; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    if ((res.status === 429 || res.status >= 500) && attempt < max - 1) {
      const wait = Math.min(15000, 800 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`${label} error ${res.status}: ${await res.text()}`);
  }
  throw new Error(`${label}: retries exhausted`);
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly version: string;
  readonly dim: number;
  private readonly apiKey: string;
  private readonly baseURL: string;

  constructor(opts: {
    apiKey: string;
    baseURL: string;
    model: string;
    dim: number;
    version?: string;
  }) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL.replace(/\/$/, "");
    this.model = opts.model;
    this.dim = opts.dim;
    this.version = opts.version ?? "1";
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Shares the budget with every other provider call (chat, vision, STT): the concurrency
    // limit is per API key, not per endpoint type.
    const res = await withLlmSlot(() =>
      postWithRetry(
        `${this.baseURL}/embeddings`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({ model: this.model, input: texts }),
        },
        `Embeddings ${this.model}`,
      ),
    );
    const json = (await res.json()) as {
      data: { embedding: number[]; index: number }[];
      usage?: { total_tokens?: number; prompt_tokens?: number };
    };
    reportEmbeddingUsage({
      model: this.model,
      totalTokens: json.usage?.total_tokens ?? json.usage?.prompt_tokens ?? 0,
      count: texts.length,
    });
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
