import { html } from "hono/html";
import { contextEntryType } from "@cortex/shared";
import type { ProjectCriteriaView } from "@cortex/core";
import type { Html } from "./layout.js";
import { keepsType, MEMO_TYPE_DEFINITIONS } from "@cortex/core";

function listField(name: string, label: string, own: string[], inherited: string[]): Html {
  return html`<label>${label}
      <textarea name="${name}" rows="3" placeholder="One per line">${own.join("\n")}</textarea>
    </label>
    ${inherited.length ? html`<p class="meta">From a parent: ${inherited.join("; ")}</p>` : ""}`;
}

export function criteriaPanel(slug: string, criteria: ProjectCriteriaView): Html {
  const { own, inherited } = criteria;
  return html`<div class="panel">
    <h2>What this project keeps</h2>
    <p class="sub">
      What the agents keep when they distil a session in this project. It starts from what its parent keeps and can
      only narrow it: a type a parent discards stays discarded here. The line next to a type says what counts as one in
      this project.
    </p>
    <form method="post" action="/p/${slug}/settings/criteria" class="stack">
      <table>
        <thead><tr><th>Type</th><th>Keep</th><th>What counts here</th></tr></thead>
        <tbody>
          ${contextEntryType.options.map((type) => {
            const discardedAbove = !keepsType(inherited, type);
            const kept = !discardedAbove && (own?.types[type]?.keep ?? true);
            return html`<tr>
              <td><b>${type}</b><div class="meta">${MEMO_TYPE_DEFINITIONS[type].is}</div></td>
              <td>
                <label class="check">
                  <input type="checkbox" name="keep.${type}"
                    ${kept ? "checked" : ""} ${discardedAbove ? "disabled" : ""}>
                  ${discardedAbove ? "discarded by a parent" : ""}
                </label>
              </td>
              <td>
                <input type="text" name="guidance.${type}" maxlength="200" value="${own?.types[type]?.guidance ?? ""}"
                  placeholder="${inherited.types[type]?.guidance ?? ""}">
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
      ${listField("keepList", "Always keep", own?.keep ?? [], inherited.keep)}
      ${listField("discardList", "Never keep", own?.discard ?? [], inherited.discard)}
      <div class="row"><button type="submit">Save</button></div>
    </form>
  </div>`;
}
