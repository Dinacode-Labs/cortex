import { canonicalize } from "./text.js";

/** Normaliza un nombre a un slug estable (sin acentos, kebab-case). */
export function slugify(name: string): string {
  // Reutiliza la normalizaci\u00f3n can\u00f3nica base (NFD + sin diacr\u00edticos + min\u00fasculas
  // + trim + colapsa espacios) y la lleva a kebab-case acotado a 60 caracteres.
  return (
    canonicalize(name)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "proyecto"
  );
}
