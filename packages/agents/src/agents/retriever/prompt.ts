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

Answer the question based only on the context above. Highlight risks, decisions in force and
constraints when they are relevant. When information is missing, say so.`;
}
