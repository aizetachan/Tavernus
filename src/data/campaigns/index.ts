/**
 * Campañas escritas. `authoredSeed('brezal')` devuelve un WorldSnapshot igual
 * que `generateSeed` (src/worldgen): el mismo validador, el mismo arranque
 * (Engine.boot), las mismas situaciones iniciales (claimSituation). Lo que
 * cambia es de dónde sale el mundo: escrito a mano y fijo, en vez de generado.
 */

import type { Id, WorldSnapshot } from '../../engine/model.js';
import { validateSnapshot } from '../../worldgen/validate.js';
import { BREZAL } from './brezal/index.js';
import { expandAuthored, type AuthoredCampaign } from './format.js';

export type { AuthoredCampaign } from './format.js';

export const AUTHORED_CAMPAIGNS: Readonly<Record<Id, AuthoredCampaign>> = { brezal: BREZAL };

export function isAuthoredCampaign(id: Id): boolean {
  return Object.prototype.hasOwnProperty.call(AUTHORED_CAMPAIGNS, id);
}

export class AuthoredCampaignError extends Error {
  constructor(message: string, readonly errors: string[] = []) { super(message); }
}

/** Mundo de una campaña escrita, listo para Engine.boot({ seed }). Nace en `now` a la hora de la campaña. */
export function authoredSeed(id: Id, opts: { now?: Date } = {}): WorldSnapshot {
  const a = AUTHORED_CAMPAIGNS[id];
  if (!a) throw new AuthoredCampaignError(`No hay campaña escrita «${id}».`);
  const snap = expandAuthored(a, opts.now ?? new Date());
  const errs = validateSnapshot(snap);
  if (errs.length) throw new AuthoredCampaignError(`La campaña «${id}» no es coherente: ${errs[0]}`, errs);
  return snap;
}
