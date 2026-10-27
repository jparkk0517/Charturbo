import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    fs: {
      allow: ['..'],
    },
  },
  test: {
    // Example lifecycle tests import the SDK by its public package name before a library build.
    alias: { charturbo: new URL('./src/index.ts', import.meta.url).pathname },
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
