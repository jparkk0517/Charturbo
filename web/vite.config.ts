import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    fs: {
      allow: ['..'],
    },
  },
  test: {
    // Example lifecycle tests import the SDK by its public package name before a library build.
    // fileURLToPath decodes %20 so checkouts under paths with spaces resolve.
    alias: { charturbo: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/__tests__/setup-locale.ts'],
  },
});
