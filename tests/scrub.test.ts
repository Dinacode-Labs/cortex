import { describe, it, expect } from "vitest";
import { scrub } from "@cortex/shared";

/**
 * `scrub()` es código de SEGURIDAD y ahora vive en @cortex/shared: lo usan agents (antes
 * del LLM), core (antes de persistir) y los conectores. `tests/transcript-utils.test.ts`
 * cubre los patrones históricos a través del re-export; aquí se fijan los AÑADIDOS al
 * centralizarlo (backlog #6) y la propiedad de idempotencia, de la que depende aplicarlo
 * en varias capas sin corromper el texto. Secretos SINTÉTICOS, ninguno real.
 */
describe("scrub — patrones añadidos al centralizar en shared", () => {
  it("redacta la contraseña de una connection string y conserva host y usuario", () => {
    const s = scrub("DATABASE_URL=postgres://cortex:s3cr3tP4ss@db.internal:5432/cortex");
    expect(s).not.toContain("s3cr3tP4ss");
    expect(s).toContain("postgres://cortex:[REDACTED]@db.internal:5432/cortex");
  });

  it("cubre otros esquemas con credenciales embebidas (mongodb+srv, redis, amqp)", () => {
    const s = scrub("mongodb+srv://app:mongoPass123@cluster0.example.net/db redis://user:redisPass99@cache:6379");
    expect(s).not.toContain("mongoPass123");
    expect(s).not.toContain("redisPass99");
  });

  it("redacta cabeceras Cookie / Set-Cookie de un volcado de request", () => {
    const s = scrub(["GET /admin HTTP/1.1", "Cookie: session=abc123def456ghi789jkl", "Accept: */*"].join("\n"));
    expect(s).not.toContain("abc123def456ghi789jkl");
    expect(s).toContain("Cookie: [REDACTED]");
    expect(s).toContain("Accept: */*"); // el resto de la petición se conserva
  });

  it("no toca prosa que solo mencione cookies", () => {
    const text = "Decisión: la política de cookies se acepta en el primer render del portal.";
    expect(scrub(text)).toBe(text);
  });

  it("redacta Authorization: Basic", () => {
    const s = scrub("Authorization: Basic dXNlcjpwYXNzd29yZDEyMzQ1Ng==");
    expect(s).not.toContain("dXNlcjpwYXNzd29yZDEyMzQ1Ng==");
    expect(s).toContain("Basic [REDACTED]");
  });

  it("redacta claves de Anthropic, npm y Stripe", () => {
    const s = scrub(
      "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 sk_live_ABCDEFGHIJKLMNOP1234",
    );
    expect(s).not.toContain("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(s).not.toContain("npm_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(s).not.toContain("sk_live_ABCDEFGHIJKLMNOP1234");
  });

  it("es idempotente: aplicarlo dos veces da el mismo resultado", () => {
    const raw = "key sk-abcDEF123456ghiJKL789 y postgres://u:p4ssw0rdLargo@h/d y Bearer abcdefghijklmnopqrstu";
    const once = scrub(raw);
    expect(scrub(once)).toBe(once);
  });

  it("deja intacto el texto de conocimiento normal", () => {
    const text = "Restricción del cliente: el despliegue se hace los martes y requiere ventana de 30 minutos.";
    expect(scrub(text)).toBe(text);
  });
});
