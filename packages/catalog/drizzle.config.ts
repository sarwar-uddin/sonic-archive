import { defineConfig } from 'drizzle-kit';

// Used only to *generate* migration SQL from the schema. Migrations are
// applied by the app's own runner (src/db/migrate.ts), which backs up first.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
