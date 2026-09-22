import { describe, it, expect, beforeAll } from "vitest";
import {
  createProject,
  canAccessProject,
  findProjectBySlug,
  listProjectMembers,
  requestOtp,
  saveContext,
  verifyOtp,
  type ProjectRef,
} from "@cortex/core";
import { createApp as createServerApp } from "../../apps/server/src/app.js";

/**
 * ADR-0051: a project has a life after being created.
 *
 * Until now visibility was fixed at creation with no way to change it -- no UI, no API, no CLI,
 * no domain function -- members were only touched by a global admin, and whatever a `save`
 * created was born with no slug, no owner and public: impossible to link, to adopt or to close.
 */
const RID = Math.random().toString(36).slice(2, 8);
const OWNER = `owner-${RID}@example.com`;
const OTRO = `otro-${RID}@example.com`;

async function tokenDe(email: string): Promise<string> {
  // The code is looked for on THIS email's line: several integration files intercept
  // `console.log` at once, and taking the first six-digit number takes somebody else's.
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
  const linea = cap.split("\n").find((l) => l.includes(email));
  const code = linea?.match(/(\d{6})/)?.[1];
  if (!code) throw new Error(`the OTP for ${email} was not captured`);
  return (await verifyOtp(email, code)).token;
}


let tokOwner: string;
let tokOtro: string;
let project_: ProjectRef;

beforeAll(async () => {
  tokOwner = await tokenDe(OWNER);
  tokOtro = await tokenDe(OTRO);
  project_ = await createProject(`Lifecycle ${RID}`, { ownerEmail: OWNER });
}, 60_000);

describe("the life of a project_ (ADR-0051)", () => {
  it("the owner changes visibility; whoever cannot manage, cannot", async () => {
    const srv = createServerApp();
    const patch = (token: string, body: unknown) =>
      srv.request(`/projects/${project_.slug}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const ajeno = await patch(tokOtro, { visibility: "private" });
    expect(ajeno.status).toBe(403);
    expect((await findProjectBySlug(project_.slug!))!.visibility).toBe("public");

    const propio = await patch(tokOwner, { visibility: "private" });
    expect(propio.status).toBe(200);
    expect((await findProjectBySlug(project_.slug!))!.visibility).toBe("private");
  });

  it("turning it private closes access at once, without touching the entries", async () => {
    const p = (await findProjectBySlug(project_.slug!))!;
    expect(await canAccessProject(p, OTRO)).toBe(false);
    expect(await canAccessProject(p, OWNER)).toBe(true);

    const srv = createServerApp();
    await srv.request(`/projects/${project_.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(await canAccessProject((await findProjectBySlug(project_.slug!))!, OTRO)).toBe(true);
  });

  it("the owner manages their members without being a global admin", async () => {
    const srv = createServerApp();
    const res = await srv.request(`/projects/${project_.slug}/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ email: OTRO }),
    });
    expect(res.status).toBe(200);
    expect(await listProjectMembers(project_.slug!)).toContain(OTRO);

    const remove_ = await srv.request(`/projects/${project_.slug}/members`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOtro}`, "content-type": "application/json" },
      body: JSON.stringify({ email: OTRO }),
    });
    expect(remove_.status, "a member is not a manager").toBe(403);
  });

  it("a project created by `save` is born with a slug and an owner", async () => {
    const name_ = `Nacido De Save ${RID}`;
    await saveContext({ content: `Some decision or other ${RID}.`, project: name_, createdBy: OWNER });
    const p = await findProjectBySlug("nacido-de-save-" + RID.toLowerCase());
    expect(p, "it should have a slug, which is what makes it linkable").toBeTruthy();
    expect(p!.ownerEmail).toBe(OWNER);
  }, 60_000);

  it("a project can be hung under a parent AFTER it was created", async () => {
    // The real case: a client with several repos that are not a monorepo, and somebody on the
    // team creates one of the children without `--parent`. Without this there was no fix:
    // neither re-attaching nor recreating, because the slug was already taken.
    const parent_ = await createProject(`Cliente ${RID}`, { ownerEmail: OWNER });
    const huerfano = await createProject(`Repo Suelto ${RID}`, { ownerEmail: OWNER });
    expect(huerfano.parentId).toBeNull();

    const srv = createServerApp();
    const res = await srv.request(`/projects/${huerfano.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ parentSlug: parent_.slug }),
    });
    expect(res.status).toBe(200);
    expect((await findProjectBySlug(huerfano.slug!))!.parentId).toBe(parent_.id);

    // And the child inherits the parent's access: turning the parent private closes both.
    await srv.request(`/projects/${parent_.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ visibility: "private" }),
    });
    expect(await canAccessProject((await findProjectBySlug(huerfano.slug!))!, OTRO)).toBe(false);
  }, 60_000);

  it("a parent cycle cannot be built, which would leave the permissions going round", async () => {
    const a = await createProject(`Ciclo A ${RID}`, { ownerEmail: OWNER });
    const b = await createProject(`Ciclo B ${RID}`, { ownerEmail: OWNER, parentSlug: a.slug! });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${a.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOwner}`, "content-type": "application/json" },
      body: JSON.stringify({ parentSlug: b.slug }),
    });
    expect(res.status).toBe(400);
    expect((await findProjectBySlug(a.slug!))!.parentId).toBeNull();
  }, 60_000);

  it("an empty project can be deleted: undoing a mistaken `link --create`", async () => {
    const error_ = await createProject(`Nombre Equivocado ${RID}`, { ownerEmail: OWNER });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${error_.slug}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOwner}` },
    });
    expect(res.status).toBe(200);
    expect(await findProjectBySlug(error_.slug!)).toBeNull();
  }, 60_000);

  it("one WITH memory inside cannot: invalidating is not deleting, and that cannot be one click away", async () => {
    const withMemory = await createProject(`Con Memoria ${RID}`, { ownerEmail: OWNER });
    await saveContext({ content: `A decision we do not want to lose ${RID}.`, project: withMemory.name, createdBy: OWNER });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${withMemory.slug}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOwner}` },
    });
    expect(res.status).toBe(409);
    expect(await findProjectBySlug(withMemory.slug!), "it is still there").toBeTruthy();
  }, 60_000);

  it("nor can one with children, which would leave the children dangling", async () => {
    const parent_ = await createProject(`Padre Con Hijos ${RID}`, { ownerEmail: OWNER });
    await createProject(`Hijo De ${RID}`, { ownerEmail: OWNER, parentSlug: parent_.slug! });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${parent_.slug}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOwner}` },
    });
    expect(res.status).toBe(409);
  }, 60_000);

  it("and whoever cannot manage it cannot delete it even when empty", async () => {
    const mio = await createProject(`Solo Mio ${RID}`, { ownerEmail: OWNER });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${mio.slug}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${tokOtro}` },
    });
    expect(res.status).toBe(403);
    expect(await findProjectBySlug(mio.slug!)).toBeTruthy();
  }, 60_000);

  it("a project_ you cannot see answers 404 when you try to manage it, not 403", async () => {
    const privado = await createProject(`Privado Ajeno ${RID}`, { visibility: "private", ownerEmail: OWNER });
    const srv = createServerApp();
    const res = await srv.request(`/projects/${privado.slug}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokOtro}`, "content-type": "application/json" },
      body: JSON.stringify({ visibility: "public" }),
    });
    expect(res.status).toBe(404); // a 403 would confirm it exists
  });
});
