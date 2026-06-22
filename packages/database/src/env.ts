import { requireEnv } from "@cortex/shared";

export function getDatabaseUrl(): string {
  return requireEnv("DATABASE_URL");
}
