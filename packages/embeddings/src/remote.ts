import { type EmbeddingProvider } from "./provider.js";

/** OpenAI text-embedding-3-small (1536 dims). Requiere OPENAI_API_KEY. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model = "text-embedding-3-small";
  readonly version = "1";
  readonly dim = 1536;

  constructor(private readonly apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/** Voyage AI voyage-3 (1024 dims). Requiere VOYAGE_API_KEY. */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly model = "voyage-3";
  readonly version = "1";
  readonly dim = 1024;

  constructor(private readonly apiKey: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Voyage embeddings error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
