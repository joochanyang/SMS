import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      '.bkit/**',
      '.claude/**',
      '.next/**',
      '.planning/**',
      '.playwright-mcp/**',
      'admin/.next/**',
      'test-txg*.ts',
    ],
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
