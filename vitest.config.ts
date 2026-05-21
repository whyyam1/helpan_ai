import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Real-DB integration tests share a single Postgres instance and a shared
    // table schema. Running test files in parallel produces races on TRUNCATE
    // / SELECT timing — file A's `resetTestData` wipes data file B has just
    // inserted. Serialise file execution so each test file owns the DB
    // exclusively from its first beforeEach to its last afterAll.
    //
    // Tests WITHIN a single file remain sequential by Vitest default. Stub-DB
    // tests don't need this guarantee but pay no extra cost from it (suite
    // duration stays under ~30s with TEST_DATABASE_URL set, ~5s without).
    fileParallelism: false,
    // Real-DB integration tests do multiple sequential transactions per test
    // (agent register + authority issue + dispatch × N) and exceed the
    // default 5s ceiling against a remote-ish Postgres. The unit tests are
    // unaffected — they finish in milliseconds.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/db/migrations/**'],
    },
  },
});
