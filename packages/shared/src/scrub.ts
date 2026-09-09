/**
 * Borrado de secretos (best-effort, amplio). Función PURA y sin I/O: vive en `shared`
 * para que la usen las tres capas que la necesitan —agents (antes de mandar nada al LLM),
 * core (antes de persistir) y los conectores— sin duplicar patrones.
 *
 * Principio: es un filtro de última línea, no una garantía. Prefiere redactar de más
 * (algún falso positivo) a dejar escapar una credencial. Complementa, no sustituye, a
 * no meter secretos en el contexto.
 */

/** Borra secretos de un texto antes de mandarlo al LLM o de guardarlo. */
export function scrub(s: string): string {
  return (
    s
      // --- Bloques y tokens con formato propio ---
      .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED_KEY]")
      .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g, "[REDACTED_JWT]")
      // --- Claves de proveedor por prefijo ---
      .replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
      .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
      .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, "[REDACTED]")
      .replace(/\bnpm_[A-Za-z0-9]{30,}/g, "[REDACTED]")
      .replace(/(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED]")
      .replace(/xox[baprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED]")
      .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED]")
      .replace(/GOCSPX-[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
      .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
      // --- Credenciales embebidas en connection strings (usuario:PASS@host) ---
      .replace(
        /\b((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|amqps|mssql|ftp|ssh):\/\/[^:\s/@]+:)[^@\s/]+@/gi,
        "$1[REDACTED]@",
      )
      // --- Cabeceras HTTP (volcados de curl -v, logs de request) ---
      .replace(/\bBearer\s+[A-Za-z0-9._-]{16,}/g, "Bearer [REDACTED]")
      .replace(/\bBasic\s+[A-Za-z0-9+/=]{16,}/g, "Basic [REDACTED]")
      // Solo al principio de línea: evita comerse prosa que mencione "cookies".
      .replace(/^[ \t>-]*(cookie|set-cookie)[ \t]*:[ \t]*\S.{7,}$/gim, "$1: [REDACTED]")
      // --- Asignaciones genéricas (api_key=..., password: ..., token = ...) ---
      .replace(
        /\b(api[_-]?key|apikey|token|secret|password|passwd|pwd|access[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9._\-/+]{12,}["']?/gi,
        "$1=[REDACTED]",
      )
  );
}
