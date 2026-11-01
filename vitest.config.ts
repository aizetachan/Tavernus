import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // Con la máquina cargada todo tarda más: el plazo solo cuenta cuando un test ya va a fallar.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Los activos escritos de assets/campaigns no entran en los tests: cada test que los usa trae los suyos.
    env: { ASSETS_DIR: 'test/fixtures/sin-activos' },
  },
});
