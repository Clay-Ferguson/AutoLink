import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // VS Code supplies the `vscode` module only inside the editor; tests get a fake.
    alias: { vscode: fileURLToPath(new URL('./src/test/fakeVscode.ts', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
