import type { Context } from "hono";
import type { z } from "zod";

/**
 * Validación de bodies JSON con zod (v3) en el borde HTTP. Sustituye el parseo
 * manual con casts `as never` que había en app.ts: cada router define su schema
 * de REQUEST y llama a `parseBody`.
 */

/**
 * Lee el body JSON y lo valida contra `schema`. Si no valida, devuelve la Response
 * 400 con `{ error, issues }` legible (path + mensaje); si valida, devuelve los
 * datos tipados. Uso en handlers: `if (body instanceof Response) return body;`
 */
export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S> | Response> {
  // JSON inválido o body vacío → {} → los issues reportan los campos que faltan.
  const raw: unknown = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid request body.",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      400,
    );
  }
  return parsed.data;
}
