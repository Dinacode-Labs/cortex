import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql, getSql } from "@cortex/database";
import {
  agentPromptChain,
  createProject,
  requestOtp,
  verifyOtp,
  deleteProject,
  getAgentPrompts,
  saveContext,
  saveWithReconciliation,
  searchContext,
  setAgentPrompts,
  setClassifier,
  setReconciler,
  setReranker,
  type ProjectRef,
} from "@cortex/core";
import { agentPromptsResponse } from "@cortex/shared";
import { createApp as createServerApp } from "../../apps/server/src/app.js";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = { email: `agent-prompts-owner-${RID}@example.com` };
const ADMIN = { email: `agent-prompts-admin-${RID}@example.com` };
const STRANGER = { email: `agent-prompts-stranger-${RID}@example.com` };
const previousAdmins = process.env.CORTEX_ADMIN_EMAIL;

let parent: ProjectRef;
let child: ProjectRef;
const tokens: Record<string, string> = {};

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

beforeAll(async () => {
  process.env.CORTEX_ADMIN_EMAIL = ADMIN.email;
  for (const email of [OWNER.email, ADMIN.email, STRANGER.email]) tokens[email] = await tokenFor(email);
  parent = await createProject(`IT Prompts Parent ${RID}`, { ownerEmail: OWNER.email });
  child = await createProject(`IT Prompts Child ${RID}`, { ownerEmail: OWNER.email, parentSlug: parent.slug });
}, 120_000);

afterAll(async () => {
  // Root is shared by every test in this database: what this file sets there, it takes back.
  await setAgentPrompts(null, { graph: null, reranker: null }, ADMIN);
  process.env.CORTEX_ADMIN_EMAIL = previousAdmins;
  await closeSql();
});

/**
 * Root is the NULL project, and a unique index treats two NULLs as different unless told
 * otherwise: without `NULLS NOT DISTINCT`, every save at root would add a row instead of
 * replacing it, and the chain would carry two root prompts (ADR-0088).
 */
describe("the prompts stored at root and on each project", () => {
  it("reach a role as one chain: root, then the parent, then the child", async () => {
    await setAgentPrompts(null, { graph: `Root ${RID}.` }, ADMIN);
    await setAgentPrompts(parent.slug!, { graph: `Parent ${RID}.` }, OWNER);
    await setAgentPrompts(child.slug!, { graph: `Child ${RID}.` }, OWNER);

    expect(await agentPromptChain("graph", child.id)).toEqual({
      root: `Root ${RID}.`,
      projects: [`Parent ${RID}.`, `Child ${RID}.`],
    });
    expect(await agentPromptChain("graph", parent.id)).toEqual({ root: `Root ${RID}.`, projects: [`Parent ${RID}.`] });
    expect((await agentPromptChain("graph", null)).projects).toEqual([]);
  });

  it("keeps one root prompt per role, and saving it again replaces it", async () => {
    await setAgentPrompts(null, { graph: `Root ${RID}, first.` }, ADMIN);
    await setAgentPrompts(null, { graph: `Root ${RID}, second.` }, ADMIN);

    const rows = await getSql()`SELECT prompt FROM agent_prompts WHERE project_id IS NULL AND role = 'graph'`;
    expect(rows.map((r) => r.prompt)).toEqual([`Root ${RID}, second.`]);
  });

  it("shows who changed a project's prompt, and drops it on an empty text", async () => {
    await setAgentPrompts(child.slug!, { retriever: `Bullet points ${RID}.` }, OWNER);
    const retriever = (await getAgentPrompts(child.slug!)).find((v) => v.role === "retriever");
    expect(retriever?.own?.updatedBy).toBe(OWNER.email);

    await setAgentPrompts(child.slug!, { retriever: "" }, OWNER);
    expect((await getAgentPrompts(child.slug!)).find((v) => v.role === "retriever")?.own).toBeNull();
  });

  it("go with the project when it is deleted", async () => {
    const doomed = await createProject(`IT Prompts Doomed ${RID}`, { ownerEmail: OWNER.email });
    await setAgentPrompts(doomed.slug!, { reranker: "Recent first." }, OWNER);
    await deleteProject(doomed.slug!, OWNER);

    const rows = await getSql()`SELECT 1 FROM agent_prompts WHERE project_id = ${doomed.id}`;
    expect(rows).toHaveLength(0);
  });
});

/**
 * The project's prompt only applies if the hooks `core` calls are told which project the call is
 * for, through the paths a memo and a search really take.
 */
describe("the project a call is for reaches the hooks", () => {
  it("of the classifier, when a memo is saved", async () => {
    const asked: (string | null)[] = [];
    setClassifier(async (_content, { projectId }) => {
      asked.push(projectId);
      return null;
    });
    try {
      await saveContext({ project: child.name, content: `A memo for the prompts ${RID}.` }, { skipEmbedding: true });
    } finally {
      setClassifier(null);
    }
    expect(asked).toEqual([child.id]);
  });

  it("of the reranker, when the project is searched", async () => {
    const asked: (string | null)[] = [];
    setReranker(async (_query, hits, { projectId }) => {
      asked.push(projectId);
      return hits;
    });
    try {
      await searchContext({ query: `prompts ${RID}`, project: child.name });
    } finally {
      setReranker(null);
    }
    expect(asked).toEqual([child.id]);
  });

  it("of the reconciler and the merger, when a memo is updated", async () => {
    const asked: string[] = [];
    setReconciler({
      decide: async (_existing, _incoming, { projectId }) => {
        asked.push(`decide:${projectId}`);
        return "update";
      },
      merge: async (existing, _incoming, { projectId }) => {
        asked.push(`merge:${projectId}`);
        return existing;
      },
    });
    const auto = { project: child.name, type: "decision", sourceType: "agent_session" } as const;
    const opts = { useClassifier: false, detectImprovements: false } as const;
    try {
      await saveWithReconciliation({ ...auto, content: `The ${RID} importer retries twice with a fixed delay before failing.` }, opts);
      await saveWithReconciliation({ ...auto, content: `The ${RID} importer retries twice with a fixed delay before it fails.` }, opts);
    } finally {
      setReconciler(null);
    }
    expect(asked).toEqual([`decide:${child.id}`, `merge:${child.id}`]);
  });
});

const cookieOf = (who: { email: string }) => `cortex_session=${tokens[who.email]}`;

function postForm(path: string, who: { email: string }, fields: Record<string, string>) {
  return createWebApp().request(path, {
    method: "POST",
    headers: { cookie: cookieOf(who), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

function api(path: string, who: { email: string }, init: { method?: string; body?: unknown } = {}) {
  return createServerApp().request(path, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${tokens[who.email]}`, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/**
 * The settings are only useful if a person can reach them: root from the admin area, a project's
 * from its Settings, and both from the API for whoever scripts it. Saving a form sends every
 * textarea, so the web must tell an untouched prompt from a changed one, or every save would sign
 * all seven with whoever pressed it.
 */
describe("what the agents are told, set from the web and the API", () => {
  it("shows root to admins only, with the default next to each role", async () => {
    const asAdmin = await createWebApp().request("/admin/agents", { headers: { cookie: cookieOf(ADMIN) } });
    expect(asAdmin.status).toBe(200);
    expect(await asAdmin.text()).toContain("You are Cortex&#39;s knowledge-graph agent.");

    const asOwner = await createWebApp().request("/admin/agents", { headers: { cookie: cookieOf(OWNER) } });
    expect(asOwner.status).toBe(404);
  });

  it("saves only what changed in the admin form, line breaks as a browser sends them included", async () => {
    await setAgentPrompts(null, { graph: `Root ${RID}.\nSecond line.` }, ADMIN);
    const before = (await getAgentPrompts(null)).find((v) => v.role === "graph")!.own!;

    await postForm("/admin/agents", ADMIN, { "prompt.graph": `Root ${RID}.\r\nSecond line.`, "prompt.reranker": `Recent first ${RID}.` });

    const after = await getAgentPrompts(null);
    expect(after.find((v) => v.role === "graph")!.own!.updatedAt).toEqual(before.updatedAt);
    expect(after.find((v) => v.role === "reranker")!.own?.text).toBe(`Recent first ${RID}.`);
  });

  it("lets a project's manager add to it from Settings, and shows what it inherits", async () => {
    await postForm(`/p/${child.slug}/settings/agent-prompts`, OWNER, { "prompt.distiller": `Only the public API ${RID}.` });
    expect((await agentPromptChain("distiller", child.id)).projects).toEqual([`Only the public API ${RID}.`]);

    const page = await (await createWebApp().request(`/p/${child.slug}/settings`, { headers: { cookie: cookieOf(OWNER) } })).text();
    expect(page).toContain("What the agents are told");
    expect(page).toContain(`Only the public API ${RID}.`);
    expect(page).toContain(`Recent first ${RID}.`);
  });

  it("ignores the form from someone who does not manage the project", async () => {
    await postForm(`/p/${child.slug}/settings/agent-prompts`, STRANGER, { "prompt.merger": "Keep it short." });
    expect((await agentPromptChain("merger", child.id)).projects).toEqual([]);
  });

  it("is read and changed through the API, by role, with the contract's shape", async () => {
    const patched = await api(`/projects/${child.slug}`, OWNER, {
      method: "PATCH",
      body: { agentPrompts: { retriever: `Bullet points ${RID}.` } },
    });
    expect(patched.status).toBe(200);

    const read = agentPromptsResponse.parse(await (await api(`/projects/${child.slug}/agent-prompts`, OWNER)).json());
    const retriever = read.prompts.find((p) => p.role === "retriever")!;
    expect(retriever.own?.text).toBe(`Bullet points ${RID}.`);
    expect(retriever.effective).toBe(`${retriever.default}\n\nBullet points ${RID}.`);
    expect(read.prompts.find((p) => p.role === "distiller")!.own?.text).toBe(`Only the public API ${RID}.`);
  });

  it("refuses root to anyone but an admin, and a role or a length the contract does not allow", async () => {
    const root = (body: unknown, who = ADMIN) => api("/agent-prompts", who, { method: "PATCH", body });
    expect((await root({ agentPrompts: { reranker: "Mine." } }, OWNER)).status).toBe(403);
    expect((await root({ agentPrompts: { planner: "Plan." } })).status).toBe(400);
    expect((await root({ agentPrompts: { reranker: "x".repeat(2001) } })).status).toBe(400);

    const ok = await root({ agentPrompts: { reranker: `Newest first ${RID}.` } });
    expect(ok.status).toBe(200);
    const reranker = agentPromptsResponse.parse(await ok.json()).prompts.find((p) => p.role === "reranker")!;
    expect(reranker.effective).toBe(`Newest first ${RID}.`);
  });
});
