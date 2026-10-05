import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeSql } from "@cortex/database";
import {
  createProject,
  getProjectLanguage,
  requestOtp,
  saveContext,
  saveWithReconciliation,
  setClassifier,
  setReconciler,
  updateProject,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import type { Language } from "@cortex/shared";
import { createApp as createServerApp } from "../../apps/server/src/app.js";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `language-owner-${RID}@example.com`;

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
const actor = { email: OWNER };

beforeAll(async () => {
  token = await tokenFor(OWNER);
  parent = await createProject(`IT Language Parent ${RID}`, { ownerEmail: OWNER });
  child = await createProject(`IT Language Child ${RID}`, { ownerEmail: OWNER, parentSlug: parent.slug });
}, 120_000);

afterAll(async () => {
  await closeSql();
});

/**
 * Every agent wrote Spanish, for every project, through a constant. A project now chooses, and
 * a child with no choice of its own writes in its parent's (ADR-0081). The choice only counts
 * if it reaches the hooks that call the agents, so that is checked here, through the paths a
 * memo really takes.
 */
describe("the language a project writes in", () => {
  it("is inherited from the parent, overridden by the child, and back to inherited when cleared", async () => {
    expect(await getProjectLanguage(child.slug!)).toEqual({ own: null, effective: "es" });

    await updateProject(parent.slug!, { language: "en" }, actor);
    expect(await getProjectLanguage(child.slug!)).toEqual({ own: null, effective: "en" });

    await updateProject(child.slug!, { language: "es" }, actor);
    expect(await getProjectLanguage(child.slug!)).toEqual({ own: "es", effective: "es" });

    await updateProject(child.slug!, { language: null }, actor);
    expect(await getProjectLanguage(child.slug!)).toEqual({ own: null, effective: "en" });
  });

  it("reaches the classifier when a memo is saved", async () => {
    await updateProject(parent.slug!, { language: "en" }, actor);
    const asked: Language[] = [];
    setClassifier(async (_content, { language }) => {
      asked.push(language);
      return null;
    });
    try {
      await saveContext({ project: child.name, content: `A memo saved under the child ${RID}.` }, { skipEmbedding: true });
    } finally {
      setClassifier(null);
    }
    expect(asked).toEqual(["en"]);
  });

  it("reaches the merger when reconciliation updates a memo", async () => {
    await updateProject(parent.slug!, { language: "en" }, actor);
    const merged: Language[] = [];
    setReconciler({
      decide: async () => "update",
      merge: async (existing, _incoming, { language }) => {
        merged.push(language);
        return existing;
      },
    });
    const auto = { project: child.name, type: "decision", sourceType: "agent_session" } as const;
    const opts = { useClassifier: false, detectImprovements: false } as const;
    try {
      await saveWithReconciliation(
        { ...auto, content: `The ${RID} export job retries three times with exponential backoff before giving up.` },
        opts,
      );
      const second = await saveWithReconciliation(
        { ...auto, content: `The ${RID} export job retries three times with exponential backoff before it stops.` },
        opts,
      );
      expect(second.action).toBe("update");
    } finally {
      setReconciler(null);
    }
    expect(merged).toEqual(["en"]);
  });

  it("can be set through the API, and a language it does not know is refused", async () => {
    const patch = (body: unknown) =>
      createServerApp().request(`/projects/${child.slug}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    expect((await patch({ language: "en" })).status).toBe(200);
    expect((await getProjectLanguage(child.slug!)).own).toBe("en");
    expect((await patch({ language: "fr" })).status).toBe(400);
    expect((await patch({ language: null })).status).toBe(200);
    expect((await getProjectLanguage(child.slug!)).own).toBeNull();
  });

  it("can be set from the settings page, and the page says what it inherits", async () => {
    const cookie = `cortex_session=${token}`;
    const post = (language: string) =>
      createWebApp().request(`/p/${child.slug}/settings/language`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ language }).toString(),
      });

    await updateProject(parent.slug!, { language: "en" }, actor);
    const page = await (await createWebApp().request(`/p/${child.slug}/settings`, { headers: { cookie } })).text();
    expect(page).toContain("inherited (English)");

    expect((await post("es")).status).toBe(302);
    expect((await getProjectLanguage(child.slug!)).own).toBe("es");
    expect((await post("")).status).toBe(302);
    expect((await getProjectLanguage(child.slug!)).own).toBeNull();
  });
});
