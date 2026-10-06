import { port } from "../../composition.js";

export async function indexMemos(
  items: { memoId: string; text: string }[],
  opts: { batchSize?: number; onProgress?: (done: number) => void } = {},
): Promise<void> {
  await port("memoIndex").indexMany(items, opts);
}
