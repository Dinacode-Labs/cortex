export interface ContextSnippet {
  title: string;
  summary: string;
  type: string;
}

export function retrieverPrompt(question: string, snippets: ContextSnippet[]): string {
  const context = snippets
    .map((s, i) => `${i + 1}. [${s.type}] ${s.title}: ${s.summary}`)
    .join("\n");
  return `The developer's question: ${question}

Context retrieved from Cortex:
${context}

Answer the developer's question.`;
}
