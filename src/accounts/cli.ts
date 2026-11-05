/**
 * Administrador sin navegador: `npm run admin -- <usuario>` (o `node dist/index.js --admin <usuario>`).
 *
 *   - Si el usuario existe, pasa a ser administrador (y se reactiva si estaba desactivado).
 *   - Si no existe, se crea como administrador; la contraseña se pide por la terminal sin mostrarla
 *     (o se lee de ADMIN_PASSWORD, o de la entrada estándar si no hay terminal).
 *   - Con --password, también a uno que ya existe se le pone una contraseña nueva (y se cierran sus sesiones).
 *
 * Usa la misma base que la web (DATABASE_URL; sin ella, la PGlite local de <GAMES_DIR>/.pgdata, que no se
 * puede abrir mientras la web local la tiene abierta).
 */

import { Accounts, ensureAdmin, PASSWORD_MIN } from './accounts.js';
import { dbUrlFromEnv, describeDbUrl, openDb } from '../db/db.js';
import { resolve } from 'node:path';

export async function adminCommand(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const i = argv.indexOf('--admin');
  const username = argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1]! : '';
  const reset = argv.includes('--password');
  if (!username) {
    console.error('Uso: npm run admin -- <usuario> [--password]');
    return 2;
  }
  const url = dbUrlFromEnv(env, resolve(env['GAMES_DIR'] ?? './data/games'), 'open')!;
  const db = await openDb(url);
  try {
    const accounts = new Accounts(db);
    const existing = await accounts.userByName(username);
    let password: string | null = null;
    if (!existing || reset) {
      password = env['ADMIN_PASSWORD'] || await ask(`Contraseña para ${username} (${PASSWORD_MIN} caracteres o más): `);
      if (process.stdin.isTTY && !env['ADMIN_PASSWORD']) {
        const again = await ask('Repítela: ');
        if (again !== password) { console.error('No coinciden. No se ha cambiado nada.'); return 1; }
      }
    }
    const r = await ensureAdmin(accounts, username, password, { resetPassword: reset });
    console.log(`${r.created ? 'Creado' : 'Listo'}: «${r.user.username}» es administrador${reset && !r.created ? ' y tiene contraseña nueva' : ''} (base: ${describeDbUrl(url)}).`);
    return 0;
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  } finally {
    await db.close();
  }
}

/** Pide una línea por la terminal sin mostrar lo que se escribe; sin terminal, la lee de la entrada estándar. */
function ask(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((res) => {
      let buf = '';
      stdin.setEncoding('utf8');
      const onData = (c: string) => {
        buf += c;
        const nl = buf.indexOf('\n');
        if (nl >= 0) { stdin.off('data', onData); stdin.pause(); res(buf.slice(0, nl).replace(/\r$/, '')); }
      };
      stdin.on('data', onData);
      stdin.once('end', () => res(buf.trim()));
    });
  }
  process.stdout.write(prompt);
  return new Promise((res) => {
    let buf = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (c: string) => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          process.stdout.write('\n');
          res(buf);
          return;
        }
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}
