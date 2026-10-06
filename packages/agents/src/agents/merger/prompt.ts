export function mergerPrompt(existing: string, incoming: string): string {
  return `Existing entry:\n"""\n${existing}\n"""\n\nNew information about the same thing:\n"""\n${incoming}\n"""\n\nMerge them into ONE consolidated entry.`;
}
