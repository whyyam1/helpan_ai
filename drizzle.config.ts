import type { Config } from 'drizzle-kit';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error(
    'DATABASE_URL is required for drizzle-kit. Source .env or set the variable inline.'
  );
}

export default {
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
  migrations: {
    table: '_drizzle_migrations',
    schema: 'public',
  },
} satisfies Config;
