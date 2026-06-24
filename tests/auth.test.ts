import { describe, it, expect, beforeEach } from "vitest";
import { isAllowedEmail, isAdmin } from "../packages/core/src/auth";

// isAllowedEmail / isAdmin leen el env de forma LAZY, así que se puede ajustar por test.
describe("isAllowedEmail (whitelist de dominios)", () => {
  beforeEach(() => {
    delete process.env.CORTEX_AUTH_DOMAIN;
  });

  it("acepta el dominio permitido y rechaza otros", () => {
    process.env.CORTEX_AUTH_DOMAIN = "dinacode.com";
    expect(isAllowedEmail("ruben@dinacode.com")).toBe(true);
    expect(isAllowedEmail("RUBEN@Dinacode.com")).toBe(true); // case-insensitive
    expect(isAllowedEmail("hacker@gmail.com")).toBe(false);
  });

  it("soporta varios dominios (coma-separado)", () => {
    process.env.CORTEX_AUTH_DOMAIN = "dinacode.com, partner.io";
    expect(isAllowedEmail("a@dinacode.com")).toBe(true);
    expect(isAllowedEmail("b@partner.io")).toBe(true);
    expect(isAllowedEmail("c@other.com")).toBe(false);
  });

  it("con whitelist vacía, acepta cualquiera", () => {
    process.env.CORTEX_AUTH_DOMAIN = "";
    expect(isAllowedEmail("x@cualquiera.com")).toBe(true);
  });
});

describe("isAdmin (uno o varios)", () => {
  beforeEach(() => {
    delete process.env.CORTEX_ADMIN_EMAIL;
  });

  it("reconoce varios admins y rechaza el resto", () => {
    process.env.CORTEX_ADMIN_EMAIL = "ruben@dinacode.com, alex@dinacode.com";
    expect(isAdmin("ruben@dinacode.com")).toBe(true);
    expect(isAdmin("ALEX@dinacode.com")).toBe(true);
    expect(isAdmin("bob@dinacode.com")).toBe(false);
  });

  it("null/undefined/sin config → false", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    process.env.CORTEX_ADMIN_EMAIL = "";
    expect(isAdmin("ruben@dinacode.com")).toBe(false);
  });
});
