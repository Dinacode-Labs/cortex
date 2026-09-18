import { describe, it, expect, beforeEach } from "vitest";
import { isAllowedEmail, isAdmin } from "../packages/core/src/auth";

// isAllowedEmail / isAdmin read the env LAZILY, so it can be adjusted per test.
describe("isAllowedEmail (whitelist de dominios)", () => {
  beforeEach(() => {
    delete process.env.CORTEX_AUTH_DOMAIN;
  });

  it("accepts the allowed domain and rejects the others", () => {
    process.env.CORTEX_AUTH_DOMAIN = "example.com";
    expect(isAllowedEmail("dev@example.com")).toBe(true);
    expect(isAllowedEmail("ALGUIEN@Example.com")).toBe(true); // case-insensitive
    expect(isAllowedEmail("hacker@gmail.com")).toBe(false);
  });

  it("soporta varios dominios (coma-separado)", () => {
    process.env.CORTEX_AUTH_DOMAIN = "example.com, partner.io";
    expect(isAllowedEmail("a@example.com")).toBe(true);
    expect(isAllowedEmail("b@partner.io")).toBe(true);
    expect(isAllowedEmail("c@other.com")).toBe(false);
  });

  it("with an empty whitelist, accepts anyone", () => {
    process.env.CORTEX_AUTH_DOMAIN = "";
    expect(isAllowedEmail("x@cualquiera.com")).toBe(true);
  });

  it("does not filter when the variable is unset either (it no longer inherits a default domain)", () => {
    delete process.env.CORTEX_AUTH_DOMAIN;
    // The server warns about this at startup: it is a deliberate default, not an oversight.
    expect(isAllowedEmail("x@quien-sea.com")).toBe(true);
  });
});

describe("isAdmin (uno o varios)", () => {
  beforeEach(() => {
    delete process.env.CORTEX_ADMIN_EMAIL;
  });

  it("recognises several admins and rejects everyone else", () => {
    process.env.CORTEX_ADMIN_EMAIL = "dev@example.com, alex@example.com";
    expect(isAdmin("dev@example.com")).toBe(true);
    expect(isAdmin("ALEX@example.com")).toBe(true);
    expect(isAdmin("bob@example.com")).toBe(false);
  });

  it("null/undefined/sin config → false", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    process.env.CORTEX_ADMIN_EMAIL = "";
    expect(isAdmin("dev@example.com")).toBe(false);
  });
});
