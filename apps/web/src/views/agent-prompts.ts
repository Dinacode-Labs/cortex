import { html } from "hono/html";
import { defaultCriterion } from "@cortex/agents";
import { effectiveCriterion, type AgentPromptView } from "@cortex/core";
import { AGENT_PROMPT_MAX_LENGTH, type AgentRole } from "@cortex/shared";
import { panel } from "./components.js";
import type { Html } from "./layout.js";

const ROLE_SUMMARIES: Record<AgentRole, string> = {
  classifier: "types and titles each memo saved, and names the entities in it",
  graph: "draws the entities and relations on the map",
  reranker: "orders search results by how well they answer the question",
  retriever: "writes the answer in Ask",
  distiller: "turns a finished agent session into memos",
  reconciler: "decides whether a memo adds to, refines or replaces one that is nearly the same",
  merger: "merges a refining memo into the one it refines",
};

function promptField(view: AgentPromptView, above: { label: string; text: string }, placeholder: string): Html {
  const id = `prompt-${view.role}`;
  return html`<div class="stack-sm">
    <label for="${id}"><b>${view.role}</b> <span class="sub">— ${ROLE_SUMMARIES[view.role]}</span></label>
    <details>
      <summary class="sub">${above.label}</summary>
      <div class="content-block">${above.text}</div>
    </details>
    <textarea id="${id}" name="prompt.${view.role}" maxlength="${AGENT_PROMPT_MAX_LENGTH}" placeholder="${placeholder}">${view.own?.text ?? ""}</textarea>
    ${view.own
      ? html`<p class="sub">Last changed by ${view.own.updatedBy} on ${view.own.updatedAt.toISOString().slice(0, 10)}.</p>`
      : ""}
  </div>`;
}

export function projectAgentPromptsPanel(slug: string, views: AgentPromptView[]): Html {
  return panel(
    "What the agents are told",
    html`<form method="post" action="/p/${slug}/settings/agent-prompts" class="stack">
      ${views.map((view) =>
        promptField(
          view,
          {
            label: "What it is told before this project",
            text: effectiveCriterion(defaultCriterion(view.role), view.inherited),
          },
          "Nothing added for this project.",
        ),
      )}
      <div class="row"><button type="submit">Save</button></div>
    </form>`,
    {
      help: html`Each agent judges by a text that starts with the server's and gathers every project's on the way
        down. What you write here is added for this project and its children, after what it inherits; it never
        replaces it. The format each agent answers in is fixed and goes after all of it.`,
    },
  );
}

export function rootAgentPromptsPanel(views: AgentPromptView[]): Html {
  return panel(
    null,
    html`<form method="post" action="/admin/agents" class="stack">
      ${views.map((view) =>
        promptField(view, { label: "The default, in the code", text: defaultCriterion(view.role) }, "Empty: the default applies."),
      )}
      <div class="row"><button type="submit">Save</button></div>
    </form>`,
  );
}
