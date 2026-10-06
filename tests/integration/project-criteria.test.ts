import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import {
  createProject,
  getContextPack,
  getProjectCriteria,
  renderContextPack,
  requestOtp,
  updateProject,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createServerApp } from "../../apps/server/src/app.js";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `criteria-owner-${RID}@example.com`;
const actor = { email: OWNER };

async function tokenFor(email: string): Promise<string> {
  let cap = "";
  const orig = console.log;
  console.log = ((...a: unknown[]) => {
    cap += a.join(" ") + "\n";
  }) as typeof console.log;
  try {
    await requestOtp(email);
  } finally {
    console.log = orig;
  }
  const code = cap.split("\n").find((l) => l.includes(email))?.match(/(\d{6})/)?.[1];
  if (!code) throw new Error(`the OTP for ${email} was not captured`);
  return (await verifyOtp(email, code)).token;
}

let token: string;
let parent: ProjectRef;
let child: ProjectRef;

beforeAll(async () => {
  token = await tokenFor(OWNER);
  parent = await createProject(`IT Criteria Parent ${RID}`, { ownerEmail: OWNER });
  child = await createProject(`IT Criteria Child ${RID}`, { ownerEmail: OWNER, parentSlug: parent.slug });
  const criteria = { types: { how_to: { keep: false } }, keep: ["client deadlines"], discard: [] };
  await updateProject(parent.slug!, { criteria }, actor);
}, 120_000);

afterAll(async () => {
  await closeSql();
});

/**
 * What a project keeps is stored with it and read through its ancestors (ADR-0084); the
 * settings page and the API are the two ways a manager changes it.
 */
describe("a project's criteria", () => {
  it("are stored, inherited by the child and narrowed by it", async () => {
    const narrowed = { types: { incident: { keep: false } }, keep: [], discard: ["local setup"] };
    await updateProject(child.slug!, { criteria: narrowed }, actor);
    const view = await getProjectCriteria(child.slug!);

    expect({
      own: view.own,
      inheritedKeep: view.inherited.keep,
      effectiveHowTo: view.effective.types.how_to?.keep,
      effectiveIncident: view.effective.types.incident?.keep,
      effectiveDiscard: view.effective.discard,
    }).toEqual({
      own: { types: { incident: { keep: false } }, keep: [], discard: ["local setup"] },
      inheritedKeep: ["client deadlines"],
      effectiveHowTo: false,
      effectiveIncident: false,
      effectiveDiscard: ["local setup"],
    });

    await updateProject(child.slug!, { criteria: null }, actor);
    expect((await getProjectCriteria(child.slug!)).own).toBeNull();
  });

  it("can be set through the API, which refuses what does not fit the shape", async () => {
    const patch = (body: unknown) =>
      createServerApp().request(`/projects/${child.slug}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await patch({ criteria: { types: { risk: { keep: false } } } })).status).toBe(200);
    expect((await getProjectCriteria(child.slug!)).own?.types.risk?.keep).toBe(false);
    expect((await patch({ criteria: { types: { not_a_type: { keep: false } } } })).status).toBe(400);
    expect((await patch({ criteria: { keep: ["x".repeat(201)] } })).status).toBe(400);
    expect((await patch({ criteria: null })).status).toBe(200);
  });

  it("can be set from the settings page, which shows what a parent already discards", async () => {
    const cookie = `cortex_session=${token}`;
    const page = await (await createWebApp().request(`/p/${child.slug}/settings`, { headers: { cookie } })).text();
    expect(page).toContain("What this project keeps");
    expect(page).toContain("discarded by a parent");

    const kept = ["decision", "constraint", "risk", "technical_debt", "convention", "architecture", "business_rule",
      "integration_note", "meeting_summary", "pr_summary", "ticket_resolution", "other"];
    const form = new URLSearchParams([
      ...kept.map((type) => [`keep.${type}`, "on"] as [string, string]),
      ["guidance.decision", "only those that change the public API"],
      ["keepList", "pricing\n\n  agreed scope  "],
      ["discardList", "local setup"],
    ]);
    const res = await createWebApp().request(`/p/${child.slug}/settings/criteria`, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });

    expect(res.status).toBe(302);
    expect((await getProjectCriteria(child.slug!)).own).toEqual({
      types: { incident: { keep: false }, decision: { keep: true, guidance: "only those that change the public API" } },
      keep: ["pricing", "agreed scope"],
      discard: ["local setup"],
    });
  });

  it("reach the agents: the child's pack and its agents page say what the parent discards", async () => {
    await updateProject(child.slug!, { criteria: null }, actor);
    const text = renderContextPack(await getContextPack(child.name));
    expect(text).toContain("> **What this project keeps:** do not save how_to · always save client deadlines.");

    const cookie = `cortex_session=${token}`;
    const page = await (await createWebApp().request(`/p/${child.slug}/agents`, { headers: { cookie } })).text();
    expect(page).toContain("do not save how_to");
  });
});
