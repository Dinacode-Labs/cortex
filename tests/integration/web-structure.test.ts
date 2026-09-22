import { describe, it, expect, beforeAll } from "vitest";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * ADR-0050: the UI revolves around the project.
 *
 * It used to be eight flat links, each screen with its own selector, and the project you were
 * looking at got lost when you changed section. The project is now in the URL and the sections
 * hang off it.
 */
const RID = Math.random().toString(36).slice(2, 8);
const USER = `web-${RID}@example.com`;

async function otpDe(email: string): Promise<string> {
  // The `log` sender prints `[email:log] (subject) to <email>: ...`. The code is looked for ON
  // THIS EMAIL'S LINE, not the first six-digit number that goes by: several integration files
  // intercept `console.log` at once and, without this, one takes another's code and fails with
  // "Wrong code" somewhere entirely unrelated.
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
let project_: ProjectRef;

beforeAll(async () => {
  const { token } = await verifyOtp(USER, await otpDe(USER));
  cookie = `cortex_session=${token}`;
  project_ = await createProject(`Web Structure ${RID}`, { ownerEmail: USER });
  await saveContext({
    content: `We decided to use queues for the payment retries ${RID}.`,
    project: project_.name,
    createdBy: USER,
  });
}, 120_000);

const get = (path: string) => createWebApp().request(path, { headers: { cookie } });

describe("the UI's structure (ADR-0050)", () => {
  it("the home page is the project list, not a drawer of mixed entries", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain(project_.name);
    expect(html).toContain(`/p/${project_.slug}`);
  });

  it("every project section answers and carries the slug in the URL", async () => {
    for (const suffix of ["", "/ask", "/agents", "/health", "/map", "/code", "/settings"]) {
      const res = await get(`/p/${project_.slug}${suffix}`);
      expect(res.status, `/p/<slug>${suffix}`).toBe(200);
      const html = await res.text();
      // The project travels with the tabs: changing section cannot lose it.
      expect(html, `the tabs of ${suffix || "/"} must point at the same project`).toContain(
        `/p/${project_.slug}/health`,
      );
    }
  }, 120_000);

  it("the old addresses still lead somewhere", async () => {
    const casos: [string, string][] = [
      [`/lint?project=${encodeURIComponent(project_.name)}`, `/p/${project_.slug}/health`],
      [`/pack?project=${encodeURIComponent(project_.name)}`, `/p/${project_.slug}/agents`],
      [`/graph?project=${encodeURIComponent(project_.name)}`, `/p/${project_.slug}/map`],
      [`/?project=${encodeURIComponent(project_.name)}`, `/p/${project_.slug}`],
      ["/projects", "/"],
      ["/usage", "/admin/usage"],
    ];
    for (const [vieja, nueva] of casos) {
      const res = await get(vieja);
      expect(res.status, vieja).toBe(301);
      expect(res.headers.get("location"), vieja).toBe(nueva);
    }
  });

  it("AI cost belongs to the operator: an ordinary user does not even find it", async () => {
    expect((await get("/admin/usage")).status).toBe(404); // 404 and not 403: it is not announced
  });

  it("what the agents see links to its entries, which is what makes looking at it useful", async () => {
    const html = await (await get(`/p/${project_.slug}/agents`)).text();
    expect(html).toMatch(/href="\/entry\/[0-9a-f-]{36}"/);
  }, 60_000);

  it("the UI is in English, including the part that used to be generated on the fly", async () => {
    const pages = await Promise.all(
      ["/", `/p/${project_.slug}`, `/p/${project_.slug}/health`, `/p/${project_.slug}/agents`].map(async (r) =>
        (await get(r)).text(),
      ),
    );
    // Words that once slipped into a UI declared to be in English (CLAUDE.md).
    const spanish = /\b(entradas|proyectos|Contradicciones|Riesgos conocidos|Restricciones activas|Convenciones|Posibles duplicados|incidencias|estado actual)\b/;
    for (const [i, html] of pages.entries()) {
      const body = html.split("<main>")[1] ?? html;
      expect(body, `page ${i}`).not.toMatch(spanish);
    }
  }, 120_000);

  it("it can be filtered by status, which is what makes a large memory reviewable", async () => {
    const html = await (await get(`/p/${project_.slug}?status=pending_validation`)).text();
    expect(html).toContain("pending_validation");
    // Each filter keeps the other: picking a type cannot lose the chosen status.
    expect(html).toMatch(/href="[^"]*status=pending_validation[^"]*type=decision|href="[^"]*type=decision[^"]*status=pending_validation/);
  }, 60_000);

  it("Health says how many nobody has looked at and where to start", async () => {
    const html = await (await get(`/p/${project_.slug}/health`)).text();
    expect(html).toContain("Nobody has reviewed these");
    expect(html).toContain(`/p/${project_.slug}?status=pending_validation`);
  }, 60_000);

  it("the brand is configurable in the buttons too, not only in the header", async () => {
    const html = await (await get(`/p/${project_.slug}?capture=1`)).text();
    expect(html).toContain("Cortex");
    const body = html.split("<main>")[1]!;
    // If the brand changed, these texts must change with it: they cannot be hardcoded apart
    // from the header's `getBrandName()`.
    expect(body).toMatch(/What should Cortex remember/);
  });
});
