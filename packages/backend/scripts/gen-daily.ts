import { generateDigest } from '../src/engine/digest/pipeline.js';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

async function main() {
  // Use kun.zhang's account (has preferences configured)
  const targetEmail = process.argv[2] || 'kun.zhang@voidtech.com';
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, targetEmail))
    .get();

  if (!user) {
    console.error(`User not found: ${targetEmail}`);
    process.exit(1);
  }

  console.log(`Generating daily digest for: ${user.email} (${user.id})`);
  console.time('digest');

  const result = await generateDigest(user.id, { tier: 'daily', count: 12 });

  console.timeEnd('digest');
  console.log('\n' + '='.repeat(60));
  console.log(result.contentMarkdown);
  console.log('='.repeat(60));
  console.log(`\nItems: ${result.metadata.itemCount}, Duration: ${result.metadata.pipelineDurationMs}ms`);
}

main().catch(console.error);
