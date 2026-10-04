import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Application examples use public imports. Test them against source; packed consumers verify dist separately.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^typedmailer$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
      { find: /^typedmailer\/webhooks$/, replacement: fileURLToPath(new URL('./src/webhooks.ts', import.meta.url)) },
    ],
  },
});
