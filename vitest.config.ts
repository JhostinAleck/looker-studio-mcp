import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@tests': resolve(import.meta.dirname, 'tests'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli/**',
        'src/composition-root.ts',
        'src/mcp/registry.ts',
        'src/mcp/server.ts',
        // Drives the real Looker Studio editor; covered by the manual smoke flow.
        'src/contexts/reports/infrastructure/LookerStudioUiReportRepository.ts',
        'src/contexts/authentication/infrastructure/**',
      ],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
