import { html } from "hono/html";
import type { Html } from "./layout.js";

const ADMIN_SECTIONS = [
  { id: "usage", label: "Usage", href: "/admin/usage" },
  { id: "agents", label: "Agents", href: "/admin/agents" },
] as const;

export function adminTabs(active: (typeof ADMIN_SECTIONS)[number]["id"]): Html {
  return html`<nav class="tabs admin-tabs">
    ${ADMIN_SECTIONS.map((s) => html`<a class="${s.id === active ? "on" : ""}" href="${s.href}">${s.label}</a>`)}
  </nav>`;
}
