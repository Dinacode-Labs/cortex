import { describe, it, expect, afterEach, beforeAll } from "vitest";
import {
  createProject,
  getEntryDetail,
  indexMemos,
  nextUnchecked,
  requestOtp,
  saveContext,
  setGroupJudge,
  setMemoEditor,
  suggestEdits,
  suggestionFor,
  sweepProject,
  updateEntryFields,
  verifyOtp,
  type MemoEditor,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `suggest-owner-${RID}@example.com`;

let ownerCookie: string;

beforeAll(async () => {
  let captured = "";
  const log = console.log;
  console.log = ((...a: unknown[]) => {
    captured += a.join(" ") + "\n";
  }) as typeof console.log;
  try {
    await requestOtp(OWNER);
  } finally {
    console.log = log;
  }
  const code = captured.split("\n").find((l) => l.includes(OWNER))?.match(/(\d{6})/)?.[1];
  if (!code) throw new Error(`the OTP for ${OWNER} was not captured`);
  ownerCookie = `cortex_session=${(await verifyOtp(OWNER, code)).token}`;
}, 120_000);

afterEach(() => {
  setMemoEditor(null);
  setGroupJudge(null);
});

const newProject = (label: string): Promise<ProjectRef> => createProject(`Suggest ${label} ${RID}`, { ownerEmail: OWNER });

async function save(project: ProjectRef, content: string, title = "Backoff"): Promise<string> {
  const { entry } = await saveContext({ content, title, project: project.name, type: "decision", createdBy: OWNER }, { useClassifier: false });
  return entry.id;
}

const BACKOFF = "Yesterday we found the retries were hammering the API, so now they back off exponentially.";

function editorSaying(answer: Awaited<ReturnType<MemoEditor>>): { asked: string[] } {
  const asked: string[] = [];
  setMemoEditor(async (memo) => {
    asked.push(memo.id);
    return answer;
  });
  return { asked };
}

const REWRITE = { kind: "rewrite" as const, reason: `It says when, not what holds ${RID}.`, title: "Retries back off exponentially", content: "Retries back off exponentially, so they no longer hammer the API." };

const reviewPage = (project: ProjectRef) => createWebApp().request(`/p/${project.slug}/review?lane=new`, { headers: { cookie: ownerCookie } });

/*
 * A memo distilled by a model often says how something was found, or "yesterday", instead of what
 * holds. A person checking it had to rewrite it from nothing, or let it through as it was. The
 * nightly pass now has the editing agent propose the rewrite, or that it be rejected, before the
 * person gets there (ADR-0099).
 */
describe("the editing agent's suggestion for a memo nobody has checked yet", () => {
  it("is written by the nightly pass and shown in Review, with the rewrite starting from it", async () => {
    const project = await newProject("rewrite");
    const memo = await save(project, BACKOFF);
    editorSaying(REWRITE);

    expect((await sweepProject(project.name)).suggested).toBe(1);

    const html = await (await reviewPage(project)).text();
    expect(html).toContain(REWRITE.reason);
    expect(html).toContain("Rewrite it, from the agent&#39;s version");
    expect(html).toContain(`name="title" value="${REWRITE.title}"`);
    expect(html).toContain(`>${REWRITE.content}</textarea>`);
    expect((await getEntryDetail(memo))?.entry.content).toBe(BACKOFF);
  });

  it("saving the rewrite replaces the title and the text, and the memo is checked", async () => {
    const project = await newProject("save");
    const memo = await save(project, BACKOFF);
    const response = await createWebApp().request(`/p/${project.slug}/review`, {
      method: "POST",
      headers: { cookie: ownerCookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ lane: "new", memo, decision: "modify", title: REWRITE.title, content: REWRITE.content }).toString(),
    });

    expect(response.status).toBe(302);
    const entry = (await getEntryDetail(memo))?.entry;
    expect({ title: entry?.title, content: entry?.content, status: entry?.status, confidence: entry?.confidence }).toEqual({
      title: REWRITE.title,
      content: REWRITE.content,
      status: "validated",
      confidence: "verified",
    });
    expect(await nextUnchecked(project)).toBeNull();
  });

  it("a memo that does not belong is shown with the suggestion to reject it, and nothing else changes", async () => {
    const project = await newProject("reject");
    await save(project, `Still waiting for the CI run to finish ${RID}.`);
    editorSaying({ kind: "reject", reason: `It is the progress of a task ${RID}.` });

    await suggestEdits(project.id);

    const html = await (await reviewPage(project)).text();
    expect(html).toContain("Suggests rejecting it");
    expect(html).toContain(`It is the progress of a task ${RID}.`);
  });

  it("is asked once per memo as it reads: not again the next night, and again once it is rewritten", async () => {
    const project = await newProject("once");
    const memo = await save(project, BACKOFF);
    const { asked } = editorSaying(null);

    await suggestEdits(project.id);
    await suggestEdits(project.id);
    expect(asked).toEqual([memo]);

    await updateEntryFields(memo, { content: `${BACKOFF} Capped at 60 seconds.` });
    await suggestEdits(project.id);
    expect(asked).toEqual([memo, memo]);
  });

  it("is no longer shown once the memo is rewritten another way", async () => {
    const project = await newProject("stale");
    const memo = await save(project, BACKOFF);
    editorSaying(REWRITE);
    await suggestEdits(project.id);
    expect(await suggestionFor((await getEntryDetail(memo))!.entry)).toEqual(REWRITE);

    await updateEntryFields(memo, { content: "Retries back off exponentially, capped at 60 seconds." });

    expect(await suggestionFor((await getEntryDetail(memo))!.entry)).toBeNull();
  });

  it("a provider that fails leaves the memo to be asked about the next night", async () => {
    const project = await newProject("fails");
    await save(project, BACKOFF);
    setMemoEditor(async () => {
      throw new Error("provider down");
    });
    expect(await suggestEdits(project.id)).toBe(0);

    const { asked } = editorSaying(REWRITE);
    expect(await suggestEdits(project.id)).toBe(1);
    expect(asked).toHaveLength(1);
  });

  it("leaves out a memo the pass grouped with others: merging them is the better rewrite", async () => {
    const project = await newProject("grouped");
    const older = await saveMissed(project, "Session tokens expire after fifteen minutes without activity.");
    const newer = await saveMissed(project, "Session tokens expire after fifteen minutes without any activity.");
    const { asked } = editorSaying(REWRITE);

    await sweepProject(project.name);

    expect(asked).not.toContain(older);
    expect(asked).not.toContain(newer);
  });

  it("without a model, nothing is suggested and the rewrite starts from the memo", async () => {
    const project = await newProject("no-model");
    await save(project, BACKOFF);

    expect(await suggestEdits(project.id)).toBe(0);
    const html = await (await reviewPage(project)).text();
    expect(html).toContain("Partly right? Rewrite it");
    expect(html).toContain(`name="title" value="Backoff"`);
  });
});

/** Saved without raising reviews, as a bulk upload does, so only the nightly pass groups them. */
async function saveMissed(project: ProjectRef, content: string): Promise<string> {
  const { entry } = await saveContext({ content, project: project.name, type: "decision", createdBy: OWNER }, { useClassifier: false, skipEmbedding: true });
  await indexMemos([{ memoId: entry.id, text: content }]);
  return entry.id;
}
