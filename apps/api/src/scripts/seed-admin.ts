/**
 * Creates (or resets) the admin org and owner account.
 * Usage: npx tsx src/scripts/seed-admin.ts
 */
import * as bcrypt from 'bcryptjs';
import { db, organizations, members, eq } from '@repo/db';

const ADMIN_EMAIL = 'admin@admin.com';
const ADMIN_PASSWORD = 'Admin1234!';
const ORG_NAME = 'My Organization';
const API_PORT = process.env['API_PORT'] || '5000';

async function main() {
  // Upsert org
  const existingOrg = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, ORG_NAME))
    .limit(1);

  let orgId: string;
  if (existingOrg[0]) {
    orgId = existingOrg[0].id;
    console.log(`Using existing org: ${orgId}`);
  } else {
    const [org] = await db
      .insert(organizations)
      .values({ name: ORG_NAME, plan: 'starter' })
      .returning();
    orgId = org!.id;
    console.log(`Created org: ${orgId}`);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  // Upsert admin member
  const existing = await db
    .select()
    .from(members)
    .where(eq(members.email, ADMIN_EMAIL))
    .limit(1);

  if (existing[0]) {
    await db
      .update(members)
      .set({ passwordHash, status: 'active', role: 'owner', orgId })
      .where(eq(members.email, ADMIN_EMAIL));
    console.log(`Updated existing member: ${ADMIN_EMAIL}`);
  } else {
    const [member] = await db
      .insert(members)
      .values({
        orgId,
        email: ADMIN_EMAIL,
        passwordHash,
        role: 'owner',
        status: 'active',
      })
      .returning();
    console.log(`Created member: ${member!.id}`);
  }

  console.log('\n✅ Admin account ready:');
  console.log(`   Email:    ${ADMIN_EMAIL}`);
  console.log(`   Password: ${ADMIN_PASSWORD}`);
  console.log(`   API:      POST http://localhost:${API_PORT}/api/auth/login`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
