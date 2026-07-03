import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 90000,
    // Contract tests boot a real server process; keep files sequential so
    // temp DBs and ports never race.
    fileParallelism: false,
  },
});
