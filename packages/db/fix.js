const postgres = require('postgres');
const sql = postgres('postgresql://postgres:postgres@localhost:5432/appdb');

async function fixHash() {
  const hash = '$2b$12$DqcuQXjOa5RDclDZC0XtSuF8Ki/8s.9B7VC7hxuby6JutotqMr.2W';
  await sql`UPDATE members SET password_hash = ${hash} WHERE email = 'admin@admin.com'`;
  console.log('Fixed!');
  await sql.end();
}
fixHash().catch(console.error);
