/**
 * Whoever the authenticated request belongs to: the one thing the rest of core needs to know
 * about the caller. Only the email for now, on purpose -- it is meant to grow (ADR-0078). `null`
 * where a `SessionUser` is expected keeps meaning what it always did: a trusted call (stdio MCP,
 * the admin CLI, maintenance) or an anonymous visitor, depending on the function.
 */
export interface SessionUser {
  readonly email: string;
}
