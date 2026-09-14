/** Textos de bienvenida de los canales. Se envían al crear el canal y se fijan si se puede. */

export const WELCOME: Record<string, string> = {
  'crear-personaje': [
    'La puerta está abierta. Al otro lado espera una aldea al pie de una montaña que ardió, y una historia que todavía no tiene tu nombre.',
    '',
    'Cuando quieras cruzar, pulsa **Crear personaje**. Lo que elijas solo lo verás tú.',
  ].join('\n'),
  tablon: [
    '**Tablón de la aldea.** Aquí aparece lo que es público para todo el mundo: campanas, incendios, avisos, recompensas.',
    'Lo que pasa en un sitio concreto solo lo ven los que están allí, en su propio `#pov`.',
  ].join('\n'),
  ooc: [
    '**Fuera de ficción.** Canal para hablar entre personas, no entre personajes: quedar para jugar, dudas del bot, comentarios.',
    'Para jugar, usa tu `#pov-<nombre>`. Para reportar un fallo, reacciona con ⚠️ al mensaje del bot en tu `#pov`.',
  ].join('\n'),
  reportes: [
    '**Reportes.** Solo lo ve el admin. Cada ⚠️ que un jugador pone en un mensaje del bot abre aquí un hilo con el evento enlazado; sus respuestas a ese mensaje se añaden al hilo.',
  ].join('\n'),
};

/** Primer mensaje del #pov, en voz del Narrador. Tres frases: se lee en el móvil. */
export function povWelcome(name: string): string {
  return `Escribe lo que ${name} hace y yo cuento lo que pasa. Cuando algo dependa de la suerte te pediré los dados 🎲, y el tiempo corre aunque no mires.`;
}

/** Nota técnica que acompaña al tutorial, en gris. */
export const POV_COMMANDS = 'Escribe lo que hace tu personaje. Para que te avise cuando pase algo: mantén pulsado este canal → Notificaciones → Todos los mensajes. Si algo no cuadra, ⚠️ al mensaje · /look · /inventory · /tablon · /progress · /recap · /sheet';

/** Mensaje privado a quien entra en el servidor (SPEC §11.2.1), en voz del Narrador. */
export function joinDm(guildName: string, createChannelRef: string): string {
  return [
    `Alguien ha cruzado la puerta de **${guildName}**. Bienvenido.`,
    '',
    'Aquí abajo hay una aldea al pie de una montaña que ardió, gente que calla, encargos que nadie quiere y otros viajeros como tú. Todo lo que escribas pasa de verdad, y el mundo sigue su curso aunque tú duermas.',
    '',
    `Tu historia empieza en ${createChannelRef}. Dale un nombre a quien vas a ser y entra. El resto lo cuento yo.`,
  ].join('\n');
}
