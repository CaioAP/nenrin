import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  // Required. With driver 'expo', drizzle-kit emits ./drizzle/migrations.js alongside the
  // .sql files, which is what `useMigrations` consumes at runtime. Without it the migration
  // bundle is never generated and the app starts against an empty database.
  driver: 'expo',
});
