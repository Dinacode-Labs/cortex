/**
 * Secret scrubbing (best-effort, deliberately broad). A PURE function with no I/O: it lives
 * in `shared` so the three layers that need it -- agents (before anything reaches the LLM),
 * core (before persisting) and the connectors -- can use it without duplicating patterns.
 *
 * Principle: this is a last-line filter, not a guarantee. It prefers over-redacting (the
 * odd false positive) to letting a credential through. It complements, and does not
 * replace, keeping secrets out of the context in the first place.
 */

export function scrub(s: string): string {
  return (
    s
      // --- Blocks and tokens with their own format ---
      .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED_KEY]")
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g, "[REDACTED_JWT]")
      // --- Provider keys, matched by prefix ---
      .replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
      .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, "[REDACTED]")
      .replace(/\bnpm_[A-Za-z0-9]{30,}/g, "[REDACTED]")
      .replace(/(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED]")
      .replace(/xox[baprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED]")
      .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]")
      .replace(/GOCSPX-[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
      // --- Credentials embedded in connection strings (user:PASS@host) ---
      .replace(
        /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|amqps|mssql|ftp|ssh):\/\/[^:\s/@]+:)[^@\s/]+@/gi,
        "$1[REDACTED]@",
      )
      // --- HTTP headers (curl -v dumps, request logs) ---
      .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/g, "Bearer [REDACTED]")
      .replace(/\bBasic\s+[A-Za-z0-9+/=]{16,}/g, "Basic [REDACTED]")
      // Start of line only: keeps it from eating prose that merely mentions "cookies".
      .replace(/^[ \t>-]*(cookie|set-cookie)[ \t]*:[ \t]*\S.{7,}$/gim, "$1: [REDACTED]")
      // --- Generic assignments (api_key=..., password: ..., token = ...) ---
      .replace(
        /\b(api[_-]?key|apikey|token|secret|password|passwd|pwd|access[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._\-/+]{12,}["']?/gi,
        "$1=[REDACTED]",
      )
  );
}
