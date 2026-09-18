import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * Navigating the hierarchy: from a repo to its client and from the client to its repos.
 *
 * A client with several repositories is modelled as a parent project plus one child per repo
 * (ADR-0037, ADR-0056), and context pack inheritance and permissions hang off that
 * relationship. Until now it showed up on no screen: the children appeared on the home page as
 * the parent's siblings, a child did not say what it hung off, and its pack silently mixed its
 * own knowledge with the client's.
 *
 * The rule these tests protect: inheritance goes UP (a child sees the parent's) and going down
 * always respects permissions -- a private child you are not a member of does not appear just
 * because you can see the parent.
 */
const RID = Math.random().toString(36).slice(2, 8);
const USER = `jerarquia-${RID}@example.com`;
const AJENO = `ajeno-${RID}@example.com`;

async function otpDe(email: string): Promise<string> {
  // The `log` sender prints `[email:log] (subject) to <email>: ...`. The code is looked for ON
  // THIS EMAIL'S LINE, not the first six-digit number that goes by: several integration files
  // intercept `console.log` at once.
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
  const line = cap.split("\n").find((l) => l.includes(email));
  const m = line?.match(/(\d{6})/);
  if (!m) throw new Error(`the OTP for ${email} was not captured`);
  return m[1]!;
}

let cookie: string;
let cliente: ProjectRef;
let child_: ProjectRef;
let hijoPrivado: ProjectRef;

beforeAll(async () => {
  const { token } = await verifyOtp(USER, await otpDe(USER));
  cookie = `cortex_session=${token}`;

  // All of this belongs to SOMEBODY ELSE and USER merely walks past: they see the client and
  // the repo because they are public. Access cascades through the hierarchy (ADR-0046), so to
  // prove a private child does not slip through, the viewer cannot be the parent's owner or
  // member -- being one deliberately opens the children, and that is a different thing.
  cliente = await createProject(`Cliente ${RID}`, { ownerEmail: AJENO });
  child_ = await createProject(`Repo Backend ${RID}`, { ownerEmail: AJENO, parentSlug: cliente.slug! });
  hijoPrivado = await createProject(`Repo Secreto ${RID}`, {
    ownerEmail: AJENO,
    visibility: "private",
    parentSlug: cliente.slug!,
  });

  await saveContext({
    content: `Client ${RID} requires every deployment to go through their SSH bastion.`,
    project: cliente.name,
    type: "constraint",
    createdBy: AJENO,
  });
  await saveContext({
    content: `In this repo ${RID} the migrations are applied through a manual job.`,
    project: child_.name,
    type: "decision",
    createdBy: AJENO,
  });
}, 180_000);

const get = (path: string) => createWebApp().request(path, { headers: { cookie } });

describe("the project hierarchy in the UI", () => {
  it("a child says what it hangs off, and the path leads up to the root", async () => {
    const html = await (await get(`/p/${child_.slug}`)).text();
    expect(html).toContain('class="crumbs"');
    expect(html).toContain(`href="/p/${cliente.slug}"`);
    expect(html).toContain(cliente.name);
  }, 60_000);

  it("a project with no parent paints no breadcrumb (there is no path to show)", async () => {
    const html = await (await get(`/p/${cliente.slug}`)).text();
    expect(html).not.toContain('class="crumbs"');
  }, 60_000);

  it("a client shows its repos, with the same cards as the home page", async () => {
    const html = await (await get(`/p/${cliente.slug}`)).text();
    expect(html).toContain("Projects in this client");
    expect(html).toContain(`href="/p/${child_.slug}"`);
    expect(html).toContain("project-card");
  }, 60_000);

  it("somebody else's private child_ does not show up by looking at the parent_", async () => {
    // What crosses downwards filters by permission: seeing the client does not open its private repos.
    for (const path of [`/p/${cliente.slug}`, "/"]) {
      const html = await (await get(path)).text();
      expect(html, path).not.toContain(hijoPrivado.slug!);
      expect(html, path).not.toContain(hijoPrivado.name);
    }
    // And it stays unreachable head-on, not merely invisible.
    expect((await get(`/p/${hijoPrivado.slug}`)).status).toBe(403);
  }, 60_000);

  it("the home page groups the children under their client instead of mixing them in as siblings", async () => {
    const html = await (await get("/")).text();
    // THIS client's group: the home page lists every public project in the test database, so
    // the first group on the page need not be ours.
    const group = html.split('class="project-group"').find((g) => g.includes(`href="/p/${cliente.slug}"`));
    expect(group, "the client must be painted as a group, not as a loose card").toBeTruthy();
    // The child is painted INSIDE its parent's group, not loose in the top-level grid.
    expect(group!.split('class="project-children"')[1] ?? "").toContain(`href="/p/${child_.slug}"`);
  }, 120_000);

  it("what the agents see for a child says which part belongs to the client", async () => {
    const html = await (await get(`/p/${child_.slug}/agents`)).text();
    expect(html).toContain(`from ${cliente.name}`);
    // The mark goes on the inherited entry, not on all of them: the repo's own does not carry
    // it. Without this, marking everything (or marking nothing) would pass the test too.
    const blocks = html.split('class="pack-entry"').slice(1);
    const marcados = blocks.filter((b) => b.includes('class="from-project"'));
    expect(blocks.length).toBe(2); // the client's constraint plus the repo's decision
    expect(marcados).toHaveLength(1);
    expect(marcados[0]!).toContain(`from ${cliente.name}`);
  }, 120_000);

  it("in the client there is nothing inherited to mark", async () => {
    const html = await (await get(`/p/${cliente.slug}/agents`)).text();
    expect(html).not.toContain('class="from-project"');
  }, 60_000);

  it("the classes that only appear with a hierarchy are styled too", async () => {
    // `web-styles` walks a standalone project, so it never sees any of these: without this,
    // the breadcrumb or the home page's group could come out with no rule behind them.
    const css = readFileSync(resolve(import.meta.dirname, "../../apps/web/public/styles.css"), "utf8");
    const sinEstilo = new Set<string>();
    for (const path of ["/", `/p/${cliente.slug}`, `/p/${child_.slug}`, `/p/${child_.slug}/agents`]) {
      const html = await (await get(path)).text();
      const clases = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter(Boolean)));
      for (const c of clases) if (!css.includes(`.${c}`)) sinEstilo.add(`${c} (${path})`);
    }
    expect([...sinEstilo]).toEqual([]);
  }, 120_000);
});
