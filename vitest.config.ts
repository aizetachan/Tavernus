import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Los activos escritos de assets/campaigns no entran en los tests: cada test que los usa trae los suyos.
    env: { ASSETS_DIR: 'test/fixtures/sin-activos' },
  },
});
