/**
 * Hoja viva (SPEC §4.9): un embed fijado en #hoja-<nombre> que el bot edita
 * en cada cambio. Los datos salen de `sheetView`, compartido con la web.
 */

import { EmbedBuilder } from 'discord.js';
import type { Engine } from '../../engine/engine.js';
import type { Id } from '../../engine/model.js';
import { sheetView } from '../sheet-view.js';

export function renderSheet(engine: Engine, characterId: Id): EmbedBuilder {
  const s = sheetView(engine, characterId);
  return new EmbedBuilder()
    .setTitle(s.title)
    .setDescription(s.description)
    .addFields(...s.fields)
    .setFooter({ text: s.footer });
}
