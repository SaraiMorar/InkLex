import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { storagePlugin } from './server/plugin.ts';

export default defineConfig({
  plugins: [react(), storagePlugin()],
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
