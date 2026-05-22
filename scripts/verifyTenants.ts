/**
 * Quick read-only check of app_credentials state. Not committed —
 * delete after H-16 closeout verification.
 */
import postgres from 'postgres';

const sql = postgres(process.env['DATABASE_URL']!, { max: 1, prepare: false });
try {
  const rows = (await sql`
    SELECT app_id, app_name, status, scopes
    FROM app_credentials
    ORDER BY created_at ASC
  `) as unknown as readonly { app_id: string; app_name: string; status: string; scopes: string[] }[];

  console.warn(`app_credentials — ${rows.length} row(s):`);
  for (const r of rows) {
    console.warn(`  ${r.app_id.padEnd(20)} ${r.app_name.padEnd(36)} ${r.status}`);
    console.warn(`    [${r.scopes.join(', ')}]`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
