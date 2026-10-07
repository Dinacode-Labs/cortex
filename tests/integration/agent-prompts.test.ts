import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql, getSql } from "@cortex/database";
import {
  agentPromptChain,
  createProject,
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

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = { email: `agent-prompts-owner-${RID}@example.com` };
const ADMIN = { email: `agent-prompts-admin-${RID}@example.com` };
const previousAdmins = process.env.CORTEX_ADMIN_EMAIL;

let parent: ProjectRef;
let child: ProjectRef;

beforeAll(async () => {
  process.env.CORTEX_ADMIN_EMAIL = ADMIN.email;
  parent = await createProject(`IT Prompts Parent ${RID}`, { ownerEmail: OWNER.email });
  child = await createProject(`IT Prompts Child ${RID}`, { ownerEmail: OWNER.email, parentSlug: parent.slug });
}, 120_000);

afterAll(async () => {
  // Root is shared by every test in this database: what this file sets there, it takes back.
  await setAgentPrompts(null, { graph: null }, ADMIN);
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
