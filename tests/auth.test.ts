import { describe, it, expect, beforeEach } from "vitest";
import { isAllowedEmail, isAdmin } from "../packages/core/src/auth";

// isAllowedEmail / isAdmin leen el env de forma LAZY, así que se puede ajustar por test.
describe("isAllowedEmail (whitelist de dominios)", () => {
  beforeEach(() => {
    delete process.env.CORTEX_AUTH_DOMAIN;
  });

  it("acepta el dominio permitido y rechaza otros", () => {
    process.env.CORTEX_AUTH_DOMAIN = "example.com";
    expect(isAllowedEmail("ruben@example.com")).toBe(true);
    expect(isAllowedEmail("ALGUIEN@Example.com")).toBe(true); // case-insensitive
    expect(isAllowedEmail("hacker@gmail.com")).toBe(false);
  });

  it("soporta varios dominios (coma-separado)", () => {
    process.env.CORTEX_AUTH_DOMAIN = "example.com, partner.io";
    expect(isAllowedEmail("a@example.com")).toBe(true);
    expect(isAllowedEmail("b@partner.io")).toBe(true);
    expect(isAllowedEmail("c@other.com")).toBe(false);
  });

  it("con whitelist vacía, acepta cualquiera", () => {
    process.env.CORTEX_AUTH_DOMAIN = "";
    expect(isAllowedEmail("x@cualquiera.com")).toBe(true);
  });

  it("sin la variable definida tampoco filtra (ya no hereda un dominio por defecto)", () => {
    delete process.env.CORTEX_AUTH_DOMAIN;
    // El servidor avisa de esto al arrancar: es un default deliberado, no un descuido.
    expect(isAllowedEmail("x@quien-sea.com")).toBe(true);
  });
});

describe("isAdmin (uno o varios)", () => {
  beforeEach(() => {
    delete process.env.CORTEX_ADMIN_EMAIL;
  });

  it("reconoce varios admins y rechaza el resto", () => {
    process.env.CORTEX_ADMIN_EMAIL = "ruben@example.com, alex@example.com";
    expect(isAdmin("ruben@example.com")).toBe(true);
    expect(isAdmin("ALEX@example.com")).toBe(true);
    expect(isAdmin("bob@example.com")).toBe(false);
  });

  it("null/undefined/sin config → false", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    process.env.CORTEX_ADMIN_EMAIL = "";
    expect(isAdmin("ruben@example.com")).toBe(false);
  });
});
