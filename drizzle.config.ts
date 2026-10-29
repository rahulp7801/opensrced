// drizzle-kit: `npx drizzle-kit generate` writes a migration to drizzle/ from
// lib/db/schema.ts. Generating needs no database; lib/db/migrate.ts applies them.
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
});
