import { canonicalize } from "../text.js";

export function slugify(name: string): string {
  return (
    canonicalize(name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}
