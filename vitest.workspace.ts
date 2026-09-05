import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'core',
      environment: 'node',
      include: ['src/core/**/*.test.ts'],
      root: '.',
    },
    tsconfig: 'tsconfig.node.json',
  },
  {
    test: {
      name: 'renderer',
      environment: 'happy-dom',
      include: ['src/renderer/**/*.test.ts'],
      root: '.',
    },
    tsconfig: 'src/renderer/tsconfig.json',
  },
]);
