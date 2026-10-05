import { z } from "zod";

export const language = z.enum(["es", "en"]);
export type Language = z.infer<typeof language>;
