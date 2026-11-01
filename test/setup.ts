import { beforeEach } from 'vitest';
import { seededRng } from '../src/engine/dice.js';

// Azar fijo en cada test: el motor y los ids usan Math.random si no se les pasa `rng`.
// Un test que necesite un resultado concreto lo pide con su propio `rng` (docs/PLAN.md, §6).
beforeEach(() => { Math.random = seededRng(0x7a7e); });
