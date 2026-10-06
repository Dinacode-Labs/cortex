export function reconcilerPrompt(existing: string, incoming: string): string {
  return `EXISTING:\n"""\n${existing}\n"""\n\nNEW:\n"""\n${incoming}\n"""\n\nWhat is the NEW one's relationship to the EXISTING one?`;
}
