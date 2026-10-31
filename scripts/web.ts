/**
 * Arranca la web con un perfil de pruebas. Las variables se fijan aquí, no en package.json, para que
 * `npm run web:offline` y `npm run web:haiku` funcionen igual en bash, PowerShell y cmd.
 *
 * El perfil manda sobre .env y sobre la shell: offline no debe gastar aunque quede un MASTER_MODE=live
 * por ahí. Lo único que respeta de la shell es WEB_PORT, para tener dos servidores a la vez. El resto de
 * .env (claves, voces…) se carga igual.
 *
 * Uso: node --import tsx scripts/web.ts offline|haiku
 */

import { existsSync } from 'node:fs';

const PROFILES: Record<string, Record<string, string>> = {
  // Sin API de ningún tipo: la base de Anthropic apunta a un puerto muerto, por si alguna llamada se escapara del modo offline.
  offline: {
    MASTER_MODE: 'offline', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', IMAGES: 'off', TTS_PROVIDER: 'browser',
    WEB_PORT: '3107', DATA_DIR: './data/local/offline', GAMES_DIR: './data/local/offline/games',
  },
  haiku: {
    MASTER_MODE: 'live', MASTER_MODEL: 'claude-haiku-5-5', MASTER_EFFORT: 'low',
    WEB_PORT: '3108', DATA_DIR: './data/local/haiku', GAMES_DIR: './data/local/haiku/games',
  },
};

const name = process.argv[2] ?? '';
const profile = PROFILES[name];
if (!profile) {
  console.error(`Perfil desconocido «${name}». Perfiles: ${Object.keys(PROFILES).join(', ')}`);
  process.exit(1);
}

const shellPort = process.env['WEB_PORT'];
Object.assign(process.env, profile, shellPort ? { WEB_PORT: shellPort } : {});
// loadEnvFile no pisa lo que ya está en el entorno: lo del perfil gana a .env.
if (existsSync('.env')) process.loadEnvFile('.env');

console.log(`[web] perfil ${name}: http://localhost:${process.env['WEB_PORT']}/`);
if (profile['MASTER_MODE'] === 'live' && !process.env['ANTHROPIC_API_KEY']) {
  console.warn('[web] sin ANTHROPIC_API_KEY: el máster no llamará a la API. Ponla en .env o usa web:offline.');
}

process.argv.push('--web');
await import('../src/index.js');
