import { canonicalize } from "./text.js";

export function slugify(name: string): string {
  // Reuses the base canonical normalisation (NFD + diacritics stripped + lowercase + trim +
  // collapsed whitespace) and turns it into kebab-case capped at 60 characters.
  return (
    canonicalize(name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}
