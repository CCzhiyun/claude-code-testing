import { appendFile } from 'node:fs/promises';
import { runHookOnce } from '../src/hookOnce.js';
const [root, output] = process.argv.slice(2);
await runHookOnce(root!, { session: 'shared', target: 'PRIVATE-HOOK-CONTENT' }, async () => {
  await Bun.sleep(100);
  await appendFile(output!, 'executed\n');
});
