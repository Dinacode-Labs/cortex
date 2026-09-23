import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createProject, requestOtp, saveContext, verifyOtp, type ProjectRef } from "@cortex/core";
import { createApp as createWebApp } from "../../apps/web/src/app.js";

/**
 * Making sure what gets painted is actually styled.
 *
 * It is a silent, ugly failure: the HTML comes out with its `class`, the browser does not
 * complain, and the page shows up half dressed. It happened during the restructuring -- new
 * classes in the templates and no rule behind them -- and no test saw it because they all
 * looked at the content, not at the appearance. This compares the two lists.
 */
const CSS = readFileSync(resolve(import.meta.dirname, "../../apps/web/public/styles.css"), "utf8");
const RID = Math.random().toString(36).slice(2, 8);
const USER = `styles-${RID}@example.com`;

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
  project_ = await createProject(`Styles ${RID}`, { ownerEmail: USER });
  await saveContext({ content: `Some decision or other ${RID}.`, project: project_.name, createdBy: USER });
}, 120_000);

const clasesDe = (html: string): string[] => [
  ...new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter(Boolean))),
];

describe("the UI's styles", () => {
  it("every class that gets painted has a rule behind it", async () => {
    const web = createWebApp();
    const paths = [
      "/",
      `/p/${project_.slug}`,
      `/p/${project_.slug}?capture=1`,
      `/p/${project_.slug}?sort=created&group=week`,
      `/p/${project_.slug}/health`,
      `/p/${project_.slug}/agents`,
      `/p/${project_.slug}/settings`,
      `/p/${project_.slug}/map`,
      `/p/${project_.slug}/code`,
      "/search?q=decision",
    ];
    const sinEstilo = new Set<string>();
    for (const path of paths) {
      const html = await (await web.request(path, { headers: { cookie } })).text();
      for (const c of clasesDe(html)) if (!CSS.includes(`.${c}`)) sinEstilo.add(`${c} (${path})`);
    }
    expect([...sinEstilo]).toEqual([]);
  }, 180_000);

  it("the stylesheet is versioned, or the browser serves the old one", async () => {
    // With neither `Cache-Control` nor `ETag` the browser applies its own heuristic and keeps
    // the previous copy without asking: a deployed redesign nobody sees.
    const html = await (await createWebApp().request("/", { headers: { cookie } })).text();
    expect(html).toMatch(/\/styles\.css\?v=[^"]+/);
  });

  it("the CSS is balanced (one stray brace eats the rest of the file)", () => {
    expect(CSS.split("{").length).toBe(CSS.split("}").length);
  });
});
