import type { Context } from "hono";
import type { z } from "zod";

/**
 * Reads the JSON body and validates it against `schema`. When it does not validate, it returns
 * a 400 Response with a readable `{ error, issues }` (path + message); when it does, it returns
 * the typed data. Usage in handlers: `if (body instanceof Response) return body;`
 */
export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.infer<S> | Response> {
  // Invalid JSON or an empty body -> {} -> the issues report the missing fields.
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
