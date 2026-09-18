import { describe, it, expect, beforeAll } from "vitest";
import { getSql } from "@cortex/database";
import {
  createProject,
  getAcrossClient,
  linkEntryToEntity,
  relateEntries,
  requestOtp,
  resolveEntity,
  saveContext,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * "Across this client": what can only be seen by looking at a whole client (ADR-0063).
 *
 * The product's inheritance goes UP -- a repo reads the client's knowledge, never a sibling's
 * -- so what the repos share and where they contradict each other was looked at by nobody:
 * `lintProject` is per project and each child's pack only sees its own branch. Going down is
 * deliberate, happens from the parent and filters by permissions at every step, which is what
 * is most protected here.
 */
const RID = Math.random().toString(36).slice(2, 8);
const USER = `across-${RID}@example.com`; // sees the client and both public children
const OWNER = `owner-${RID}@example.com`; // owns everything, including the private child

async function otpDe(email: string): Promise<string> {
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
let client_: ProjectRef;
let repoA: ProjectRef;
let repoB: ProjectRef;
let privateRepo: ProjectRef;
let suelto: ProjectRef;
let entryA: string;
let entryB: string;

/** Stores an entry and hangs it off an entity, the way the extractor would. */
async function saveWith(project: string, contenido: string, entidad: [string, "technology" | "client"]): Promise<string> {
  const { entry } = await saveContext({ content: contenido, project, type: "decision", createdBy: OWNER });
  const e = await resolveEntity(getSql(), entidad[0], entidad[1]);
  await linkEntryToEntity(getSql(), entry.id, e.id);
  return entry.id;
}

beforeAll(async () => {
  const { token } = await verifyOtp(USER, await otpDe(USER));
  cookie = `cortex_session=${token}`;

  client_ = await createProject(`Across ${RID}`, { ownerEmail: OWNER });
  repoA = await createProject(`Across API ${RID}`, { ownerEmail: OWNER, parentSlug: client_.slug! });
  repoB = await createProject(`Across Web ${RID}`, { ownerEmail: OWNER, parentSlug: client_.slug! });
  privateRepo = await createProject(`Across Secreto ${RID}`, {
    ownerEmail: OWNER,
    visibility: "private",
    parentSlug: client_.slug!,
  });
  suelto = await createProject(`Across Suelto ${RID}`, { ownerEmail: OWNER });

  // Genuinely shared between the two public repos.
  entryA = await saveWith(repoA.name, `The ${RID} API is deployed in containers.`, [`Kubernetes${RID}`, "technology"]);
  entryB = await saveWith(repoB.name, `The ${RID} web is served from the same cluster.`, [`Kubernetes${RID}`, "technology"]);
  // Extractor noise: the client's name as a `client` entity in both repos. It is #135's case
  // and it must not come out as "shared technology".
  await saveWith(repoA.name, `Client ${RID} reviews the deployments.`, [`Client${RID}`, "client"]);
  await saveWith(repoB.name, `El client_ ${RID} pide informes mensuales.`, [`Cliente${RID}`, "client"]);
  // Shared with the PRIVATE repo: for a non-member, this does not exist.
  await saveWith(repoA.name, `The ${RID} API keeps sessions in memory.`, [`Redis${RID}`, "technology"]);
  await saveWith(privateRepo.name, `The ${RID} secret keeps them there too.`, [`Redis${RID}`, "technology"]);

  // A clash BETWEEN SIBLINGS: precisely what no lint could see.
  await relateEntries(entryA, entryB, "contradicts");
}, 240_000);

const get = (ruta: string) => createWebApp().request(ruta, { headers: { cookie } });

describe("the client_ view (core)", () => {
  it("the shared stack is entities from two or more children, without the client/project/repository noise", async () => {
    const { sharedStack } = await getAcrossClient(client_, USER);
    const names = sharedStack.map((e) => e.name);
    expect(names).toContain(`Kubernetes${RID}`);
    // The client's name hangs off both repos, so a naive cross-reference would surface it as
    // the most shared thing of all. That is extractor noise (#135), not stack.
    expect(names).not.toContain(`Cliente${RID}`);

    const k = sharedStack.find((e) => e.name === `Kubernetes${RID}`)!;
    expect(k.projects.map((p) => p.name).sort()).toEqual([repoA.name, repoB.name].sort());
  }, 120_000);

  it("a private child contributes nothing to the cross-view of somebody who cannot see it", async () => {
    const deFuera = await getAcrossClient(client_, USER);
    // `Redis` only appears in public repo A and in the private one: with no access to the
    // private one there is a single origin, so it is not "shared" and must not show up at all.
    expect(deFuera.sharedStack.map((e) => e.name)).not.toContain(`Redis${RID}`);
    expect(deFuera.children.map((c) => c.id)).not.toContain(privateRepo.id);

    const delDueno = await getAcrossClient(client_, OWNER);
    expect(delDueno.sharedStack.map((e) => e.name)).toContain(`Redis${RID}`);
  }, 120_000);

  it("the contradictions that cross projects, which no per-project lint sees", async () => {
    const { contradictions } = await getAcrossClient(client_, USER);
    const pair = contradictions.find((x) => [x.a.id, x.b.id].includes(entryA));
    expect(pair, "the clash between the two repos must show up").toBeTruthy();
    expect([pair!.a.project.name, pair!.b.project.name].sort()).toEqual([repoA.name, repoB.name].sort());
  }, 120_000);

  it("a project with no children has no cross-cutting view to show", async () => {
    const empty_ = await getAcrossClient(suelto, USER);
    expect(empty_).toEqual({ children: [], sharedStack: [], contradictions: [] });
  }, 60_000);
});

describe("the client_ view (web)", () => {
  it("the tab appears on the client and not on a standalone project", async () => {
    const cli = await (await get(`/p/${client_.slug}`)).text();
    expect(cli).toContain(`/p/${client_.slug}/across`);
    const sol = await (await get(`/p/${suelto.slug}`)).text();
    expect(sol).not.toContain(`/p/${suelto.slug}/across`);
    expect(sol).not.toContain("Across this client");
  }, 60_000);

  it("the section shows the shared stack and the clash, linked", async () => {
    const html = await (await get(`/p/${client_.slug}/across`)).text();
    expect(html).toContain(`Kubernetes${RID}`);
    expect(html).not.toContain(`Cliente${RID}`);
    expect(html).toContain(`href="/p/${repoA.slug}"`);
    expect(html).toContain(`href="/entry/${entryA}"`);
    expect(html).toContain(`href="/entry/${entryB}"`);
  }, 60_000);

  it("with no children there is no section, even typing the URL", async () => {
    expect((await get(`/p/${suelto.slug}/across`)).status).toBe(404);
  }, 60_000);

  it("searching from the parent can reach down into the children, and only when asked", async () => {
    const url = (extra: string) =>
      `/search?q=${encodeURIComponent(`cluster ${RID}`)}&project=${encodeURIComponent(client_.name)}${extra}`;
    const soloPadre = await (await get(url(""))).text();
    expect(soloPadre).not.toContain(`/entry/${entryB}`);

    const conHijos = await (await get(url("&children=1"))).text();
    expect(conHijos).toContain(`/entry/${entryB}`);
    // And each result says which repo it is from: otherwise results from three repos read as one.
    expect(conHijos).toContain(repoB.name);
  }, 120_000);

  it("coming down from the parent does not open the private child", async () => {
    const html = await (
      await get(`/search?q=${encodeURIComponent(`secreto ${RID}`)}&project=${encodeURIComponent(client_.name)}&children=1`)
    ).text();
    expect(html).not.toContain(`The secret ${RID}`);
    expect(html).not.toContain(privateRepo.name);
  }, 120_000);

  it("the client view's classes are styled", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const css = readFileSync(resolve(import.meta.dirname, "../../apps/web/public/styles.css"), "utf8");
    const html = await (await get(`/p/${client_.slug}/across`)).text();
    const clases = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter(Boolean)));
    expect([...clases].filter((c) => !css.includes(`.${c}`))).toEqual([]);
  }, 60_000);
});
