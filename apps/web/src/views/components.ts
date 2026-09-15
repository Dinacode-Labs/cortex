import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { ContextEntry } from "@cortex/shared";
import type { Html } from "./layout.js";

/**
 * Une fragmentos YA escapados (producidos por html``) con un separador literal.
 * raw() es seguro aquí: cada parte viene autoescapada de hono/html y el separador
 * es una constante del código, nunca datos de usuario/BD.
 */
export function joinHtml(parts: Html[], sep = ""): Html {
  if (parts.some((p) => p instanceof Promise)) {
    return Promise.all(parts).then((resolved) => raw(resolved.join(sep)));
  }
  return raw((parts as HtmlEscapedString[]).join(sep));
}

const STATUS_COLORS: Record<string, string> = {
  validated: "#1a7f37",
  verified: "#1a7f37",
  pending_validation: "#9a6700",
  draft: "#0969da",
  rejected: "#cf222e",
  obsolete: "#6e7781",
  superseded: "#8250df",
  historical: "#6e7781",
};

const TYPE_COLORS: Record<string, string> = {
  decision: "#0099ff",
  constraint: "#9a6700",
  incident: "#cf222e",
  risk: "#bc4c00",
  technical_debt: "#6e4cff",
  architecture: "#1a7f37",
  convention: "#57606a",
};

export function badge(text: string, color: string): Html {
  return html`<span class="badge" style="background:${color}14;color:${color};border:1px solid ${color}44">${text}</span>`;
}

export function statusBadge(status: string): Html {
  return badge(status, STATUS_COLORS[status] ?? "#57606a");
}

export function typeBadge(type: string): Html {
  return badge(type, TYPE_COLORS[type] ?? "#57606a");
}

export function confidenceBadge(confidence: string): Html {
  return badge(`conf: ${confidence}`, "#57606a");
}

export function entryCard(entry: ContextEntry): Html {
  return html`
    <a class="card" href="/entry/${entry.id}">
      <div class="card-head">
        ${typeBadge(entry.type)} ${statusBadge(entry.status)} ${confidenceBadge(entry.confidence)}
      </div>
      <h3>${entry.title}</h3>
      <p>${entry.summary ?? entry.content}</p>
      ${entry.sourceReference ? html`<div class="src">from: ${entry.sourceReference}</div>` : ""}
    </a>`;
}
