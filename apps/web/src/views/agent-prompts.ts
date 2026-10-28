import { html } from "hono/html";
import { defaultCriterion, roleModelVariable, shareLeft, type QuotaLeft, type RoleModel } from "@cortex/agents";
import { AGENT_MODEL_MAX_LENGTH, effectiveCriterion, type AgentPromptView, type SavedAgentModel } from "@cortex/core";
import { AGENT_PROMPT_MAX_LENGTH, type AgentRole } from "@cortex/shared";
import { panel, stateMark } from "./components.js";
import type { Html } from "./layout.js";
import { compactNumber, dayLabel } from "./usage.js";

const ROLE_SUMMARIES: Record<AgentRole, string> = {
  classifier: "types and titles each memo saved, and names the entities in it",
  graph: "draws the entities and relations on the map",
  reranker: "orders search results by how well they answer the question",
  retriever: "writes the answer in Ask",
  distiller: "turns a finished agent session into memos",
  reconciler: "decides whether a memo adds to, refines or replaces one that is nearly the same",
  merger: "merges a refining memo into the one it refines",
  judge: "groups, each night, the day's memos with the ones they repeat or contradict, for Review",
  editor: "suggests, each night, a better wording for the memos waiting to be checked, or rejecting them",
};

export interface AgentModelView {
  saved: SavedAgentModel | null;
  /** What the role runs on; null when it resolves to no model. */
  inForce: RoleModel | null;
  left: QuotaLeft | null;
}

const UNKNOWN_QUOTA: Record<Extract<QuotaLeft, { kind: "unknown" }>["why"], string> = {
  "no-quota-on-file": "No quota on file for this model",
  "not-reported": "The provider does not report its usage",
  "no-answer": "The provider did not answer",
};

const NEARLY_SPENT = 10;

function percent(share: number): string {
  if (share > 0 && share < 1) return "<1%";
  // Rounded to a tenth first: 0.87 / 3 comes out as 28.999…, and flooring that says 28.
  return `${Math.floor(Math.round(share * 10) / 10)}%`;
}

function shareMeter(share: number, label: string): Html {
  const mark =
    share <= 0 ? stateMark("danger", "Spent") : share < NEARLY_SPENT ? stateMark("warn", "Nearly spent") : "";
  return html`<div class="meter" role="img" aria-label="${percent(share)} ${label}"><span style="width:${share}%"></span></div>
    <b>${percent(share)}</b> ${label} ${mark}`;
}

function quotaCell(left: QuotaLeft | null): Html {
  if (!left) return html`<span class="faint">—</span>`;
  if (left.kind === "unknown") return html`<span class="faint">—</span> <span class="sub">${UNKNOWN_QUOTA[left.why]}</span>`;
  if (left.kind === "unlimited") return html`No limit`;
  if (left.kind === "tokens") {
    return html`${shareMeter(shareLeft(left)!, "left")}
      <div class="sub">${compactNumber(left.used)} of ${compactNumber(left.limit)} tokens spent since ${dayLabel(left.since)}</div>`;
  }
  return html`${shareMeter(shareLeft(left)!, "of the key's credit left")}
    <div class="sub">$${left.remaining.toFixed(2)} of $${left.limit.toFixed(2)}${left.resets ? `, resets ${left.resets}` : ""}</div>`;
}

export function agentsAtAGlance(models: Map<AgentRole, AgentModelView>): Html {
  return panel(
    "Every agent",
    html`<div class="agents-glance"><table>
      <tr><th>Agent and model</th><th>Left of its quota</th></tr>
      ${[...models].map(
        ([role, { inForce, left }]) => html`<tr>
          <td><b>${role}</b>
            <div>${inForce ? html`<code>${inForce.model}</code> <span class="sub">on ${inForce.provider}</span>` : html`<span class="faint">No model</span>`}
              · <a href="#model-${role}">Change</a></div></td>
          <td>${quotaCell(left)}</td>
        </tr>`,
      )}
    </table></div>`,
    {
      help: html`What is left is the provider's count for the whole account, not only what Cortex spent. A model's
        quota comes from <code>CORTEX_MODEL_QUOTAS_JSON</code>; a key with a credit limit reports its own.`,
    },
  );
}

function modelLine(role: AgentRole, { saved, inForce }: AgentModelView): Html {
  if (!inForce) {
    return html`<p class="sub">No model: <code>${roleModelVariable(role)}</code> names a provider with no credentials.</p>`;
  }
  const runsOn = html`<code>${inForce.model}</code> on ${inForce.provider}`;
  if (saved && inForce.saved) {
    return html`<p class="sub">Model ${runsOn}, saved here by ${saved.updatedBy} on ${saved.updatedAt.toISOString().slice(0, 10)}.</p>`;
  }
  const origin = inForce.setBy ? html`set by <code>${inForce.setBy}</code>` : "the default in the code";
  if (saved) {
    return html`<div class="warn">The model saved here, <code>${saved.model}</code>, names a provider with no credentials on this
      server, so it runs on ${runsOn}, ${origin}.</div>`;
  }
  return html`<p class="sub">Model ${runsOn}, ${origin}.</p>`;
}

function modelField(role: AgentRole, view: AgentModelView): Html {
  const id = `model-${role}`;
  return html`${modelLine(role, view)}
    <div class="row model-field">
      <label for="${id}" class="sub">Saved here</label>
      <input type="text" id="${id}" name="model.${role}" maxlength="${AGENT_MODEL_MAX_LENGTH}" value="${view.saved?.model ?? ""}"
        placeholder="Nothing: the environment's applies" autocomplete="off" spellcheck="false">
    </div>`;
}

function promptField(view: AgentPromptView, above: { label: string; text: string }, placeholder: string, model: Html | "" = ""): Html {
  const id = `prompt-${view.role}`;
  return html`<div class="stack-sm">
    <label for="${id}"><b>${view.role}</b> <span class="sub">— ${ROLE_SUMMARIES[view.role]}</span></label>
    ${model}
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

/** `models` is null when no inference provider is configured. */
export function rootAgentPromptsPanel(views: AgentPromptView[], models: Map<AgentRole, AgentModelView> | null): Html {
  return panel(
    null,
    html`<form method="post" action="/admin/agents" class="stack">
      ${models
        ? ""
        : html`<p class="sub">No inference provider is configured (<code>LLM_PROVIDER</code>), so no agent calls a model.</p>`}
      ${views.map((view) =>
        promptField(
          view,
          { label: "The default, in the code", text: defaultCriterion(view.role) },
          "Empty: the default applies.",
          models?.has(view.role) ? modelField(view.role, models.get(view.role)!) : "",
        ),
      )}
      <div class="row"><button type="submit">Save</button></div>
    </form>`,
  );
}
