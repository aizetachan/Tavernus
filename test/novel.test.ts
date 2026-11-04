import { describe, expect, it } from 'vitest';
import { blocksSpeech, cleanProse, NOVEL_JS, NOVEL_STYLE, novelBlocks } from '../src/adapters/web/novel.js';
import { PAINT_JS, PAINT_STYLE } from '../src/adapters/web/paint.js';
import { noticeOf } from '../src/adapters/web/notice.js';
import { toLabel } from '../src/adapters/web/server.js';
import type { DialogueLine } from '../src/engine/moments.js';
import { bootEngine, fakeTime } from './helpers.js';

describe('prosa del narrador sin repetir el diálogo', () => {
  it('el caso de la captura: ni la pregunta del jugador ni la paráfrasis de la posadera', () => {
    const narration = 'Preguntas a la posadera por el círculo vacío. Marisa Quijano apoya un dedo sobre el carbón: es la deuda que aún no has saldado, y se rellena con monedas o con trabajo. Calla lo que pasa con lo que no se rellena, y vuelve a su paño, a la espera.';
    const lines: DialogueLine[] = [
      { speaker: 'actor', text: '¿Qué es el círculo vacío de la cuenta?' },
      { speaker: 'npc', npc_id: 'npc_marisa', text: 'Es el hueco de lo que aún no me has pagado. Lo rellenas con monedas o con trabajo. Lo que no se rellena, se apunta en otra parte.' },
    ];
    expect(cleanProse(narration, lines)).toBe('Marisa Quijano apoya un dedo sobre el carbón. Calla lo que pasa con lo que no se rellena, y vuelve a su paño, a la espera.');
  });

  it('el jugador habla: su frase va en su burbuja y la narración solo cuenta lo que pasa', () => {
    const lines: DialogueLine[] = [{ speaker: 'actor', text: 'Busco trabajo. ¿Sabes de alguien que pague bien?' }];
    expect(cleanProse('«Busco trabajo. ¿Sabes de alguien que pague bien?», le dices al herrero. Él deja el martillo sobre el yunque y te mira de arriba abajo.', lines))
      .toBe('Él deja el martillo sobre el yunque y te mira de arriba abajo.');
    // En estilo indirecto, sin cita: también sobra.
    expect(cleanProse('Le dices al herrero que buscas trabajo bien pagado. Él deja el martillo.', lines)).toBe('Él deja el martillo.');
    // Si todo era su frase, no queda narración (no se pinta burbuja del narrador).
    expect(cleanProse('«Busco trabajo. ¿Sabes de alguien que pague bien?», le preguntas.', lines)).toBe('');
  });

  it('dos NPC hablan seguidos: quedan los gestos entre parlamentos, no lo que dicen', () => {
    const lines: DialogueLine[] = [
      { speaker: 'npc', npc_id: 'npc_doro', text: 'Nadie cruza el portón después de la campana.' },
      { speaker: 'npc', npc_id: 'npc_brenna', text: 'Déjalo, Doro. El forastero viene conmigo.' },
    ];
    const narration = 'Doro se planta delante del portón. «Nadie cruza el portón después de la campana.» Brenna llega por detrás, secándose las manos en el delantal, y le explica que el forastero viene con ella. «Déjalo, Doro. El forastero viene conmigo.» El guardia gruñe y se aparta.';
    expect(cleanProse(narration, lines)).toBe('Doro se planta delante del portón. Brenna llega por detrás, secándose las manos en el delantal. El guardia gruñe y se aparta.');
  });

  it('sin parlamentos la narración no se toca', () => {
    const t = 'Miras la cuenta con calma. Hay una fila de consumos de anoche, cama y comida.';
    expect(cleanProse(t, [])).toBe(t);
  });
});

describe('el turno en su orden real (bloques)', () => {
  const show = (narration: string, lines: DialogueLine[]) =>
    novelBlocks(narration, lines).map((b) => (b.kind === 'prose' ? `N: ${b.text}` : `${lines[b.line]!.speaker === 'actor' ? 'YO' : lines[b.line]!.npc_id}: ${b.text ?? lines[b.line]!.text}`));

  it('el caso de la captura: la frase de la posadera va entre «sigue sin rellenar» y «Vuelve a su paño»', () => {
    const lines: DialogueLine[] = [
      { speaker: 'actor', text: '¿Y si no pago, me buscarás tú o la posada?' },
      { speaker: 'npc', npc_id: 'npc_marisa', text: 'Lo que no paga la posada no lo guardo yo, y lo que no se ve en mi barra, no lo busco.' },
    ];
    const narration = 'Marisa Quijano deja de secar el vaso y te mira por encima de la barra, sin prisa. Tu tono de sorna no le arranca ni una sonrisa. Señala con la barbilla la cuenta, donde el círculo de carbón sigue sin rellenar. «Lo que no paga la posada no lo guardo yo, y lo que no se ve en mi barra, no lo busco.» Vuelve a su paño. En el rincón del fondo, el forastero gira el anillo de latón entre los dedos y no aparta la vista de ti.';
    expect(show(narration, lines)).toEqual([
      'YO: ¿Y si no pago, me buscarás tú o la posada?',
      'N: Marisa Quijano deja de secar el vaso y te mira por encima de la barra, sin prisa. Tu tono de sorna no le arranca ni una sonrisa. Señala con la barbilla la cuenta, donde el círculo de carbón sigue sin rellenar.',
      'npc_marisa: Lo que no paga la posada no lo guardo yo, y lo que no se ve en mi barra, no lo busco.',
      'N: Vuelve a su paño. En el rincón del fondo, el forastero gira el anillo de latón entre los dedos y no aparta la vista de ti.',
    ]);
    // La voz lee lo mismo y en el mismo orden, sin la frase del jugador (ya la ha escrito él).
    expect(blocksSpeech(novelBlocks(narration, lines), lines)).toBe(
      'Marisa Quijano deja de secar el vaso y te mira por encima de la barra, sin prisa. Tu tono de sorna no le arranca ni una sonrisa. Señala con la barbilla la cuenta, donde el círculo de carbón sigue sin rellenar. «Lo que no paga la posada no lo guardo yo, y lo que no se ve en mi barra, no lo busco.» Vuelve a su paño. En el rincón del fondo, el forastero gira el anillo de latón entre los dedos y no aparta la vista de ti.');
  });

  it('la captura de «¿Cuánto debo exactamente?»: la posadera habla en dos trozos y cada uno va en su sitio', () => {
    const lines: DialogueLine[] = [
      { speaker: 'actor', text: '¿Cuánto debo exactamente?' },
      { speaker: 'npc', npc_id: 'npc_innkeeper', text: 'Lo que aquí está escrito es lo que debes. Ni más, ni menos. Puedes pagarlo en monedas o trabajando. Dime tú cuál.' },
    ];
    const narration = 'Preguntas a la posadera cuánto debe la cuenta. Marisa Quijano pasa el dedo por la cifra subrayada dos veces y luego por la fila de consumos. «Lo que aquí está escrito es lo que debes. Ni más, ni menos.» Deja el carbón junto al círculo vacío. «Puedes pagarlo en monedas o trabajando. Dime tú cuál.»';
    expect(show(narration, lines)).toEqual([
      'YO: ¿Cuánto debo exactamente?',
      'N: Marisa Quijano pasa el dedo por la cifra subrayada dos veces y luego por la fila de consumos.',
      'npc_innkeeper: Lo que aquí está escrito es lo que debes. Ni más, ni menos.',
      'N: Deja el carbón junto al círculo vacío.',
      'npc_innkeeper: Puedes pagarlo en monedas o trabajando. Dime tú cuál.',
    ]);
  });

  it('rayas de diálogo a la española: parlamento, acotación y continuación', () => {
    const lines: DialogueLine[] = [{ speaker: 'npc', npc_id: 'npc_brenna', text: 'Me quemé. Como todo el mundo que trabaja al fuego.' }];
    const narration = 'La tabernera levanta la vista.\n—Me quemé —dice, y vuelve el trapo a la jarra—. Como todo el mundo que trabaja al fuego.\nNo te mira al decirlo.';
    expect(show(narration, lines)).toEqual([
      'N: La tabernera levanta la vista.',
      'npc_brenna: Me quemé',
      'N: dice, y vuelve el trapo a la jarra.',
      'npc_brenna: Como todo el mundo que trabaja al fuego.',
      'N: No te mira al decirlo.',
    ]);
  });

  it('frase al principio: primero quien habla, luego lo que pasa', () => {
    const lines: DialogueLine[] = [{ speaker: 'npc', npc_id: 'npc_doro', text: '¡Alto! ¿Quién va?' }];
    expect(show('«¡Alto! ¿Quién va?» El guardia levanta la lanza y entorna los ojos.', lines)).toEqual([
      'npc_doro: ¡Alto! ¿Quién va?',
      'N: El guardia levanta la lanza y entorna los ojos.',
    ]);
  });

  it('dos NPC distintos seguidos: dos burbujas juntas, sin narrador vacío en medio', () => {
    const lines: DialogueLine[] = [
      { speaker: 'npc', npc_id: 'npc_doro', text: 'Nadie cruza después de la campana.' },
      { speaker: 'npc', npc_id: 'npc_brenna', text: 'Déjalo, Doro. Viene conmigo.' },
    ];
    expect(show('Doro se planta delante del portón. «Nadie cruza después de la campana.» «Déjalo, Doro. Viene conmigo.» El guardia gruñe y se aparta.', lines)).toEqual([
      'N: Doro se planta delante del portón.',
      'npc_doro: Nadie cruza después de la campana.',
      'npc_brenna: Déjalo, Doro. Viene conmigo.',
      'N: El guardia gruñe y se aparta.',
    ]);
  });

  it('si una frase no está citada en la narración, va al final (o justo detrás de la anterior)', () => {
    const lines: DialogueLine[] = [
      { speaker: 'npc', npc_id: 'npc_marisa', text: 'Son tres monedas.' },
      { speaker: 'npc', npc_id: 'npc_marisa', text: 'Y la cama aparte.' },
    ];
    // Ninguna citada: la prosa entera y luego las dos, en orden.
    expect(show('Marisa gira la cuenta hacia ti y apoya el dedo en la cifra.', lines)).toEqual([
      'N: Marisa gira la cuenta hacia ti y apoya el dedo en la cifra.',
      'npc_marisa: Son tres monedas.',
      'npc_marisa: Y la cama aparte.',
    ]);
    // La primera citada y la segunda no: la segunda va pegada a la primera.
    expect(show('Marisa gira la cuenta. «Son tres monedas.» Vuelve a su paño.', lines)).toEqual([
      'N: Marisa gira la cuenta.',
      'npc_marisa: Son tres monedas.',
      'npc_marisa: Y la cama aparte.',
      'N: Vuelve a su paño.',
    ]);
  });
});

describe('las imágenes van dentro de la burbuja, nunca como tarjeta suelta', () => {
  it('el script del hilo y el del pincel siguen siendo JavaScript válido', () => {
    expect(() => new Function(NOVEL_JS)).not.toThrow();
    expect(() => new Function(PAINT_JS)).not.toThrow();
  });

  it('los momentos (retrato, objeto, combate, hallazgo, a mano) no se crean como mensaje del hilo', () => {
    // Antes eran `figure.msg.moment`, hermanas de las burbujas; ahora son `figure.moment` dentro del cuerpo de la burbuja de su turno.
    for (const code of [NOVEL_JS, PAINT_JS]) {
      expect(code).not.toMatch(/className = 'msg moment/);
      expect(code).not.toMatch(/data-for/);
      expect(code).not.toMatch(/log\.appendChild\(fig\)/);
    }
    for (const css of [NOVEL_STYLE, PAINT_STYLE]) expect(css).not.toMatch(/\.msg\.moment/);
    expect(NOVEL_JS).toMatch(/className = 'moment ' \+ x\.kind/);
    expect(NOVEL_JS).toMatch(/\.body'\) \|\| host\)\.appendChild\(fig\)/);
  });

  it('el pie de la imagen no separa con el punto medio ni la viñeta', () => {
    expect(NOVEL_JS).toContain('function momentName(n)');
    expect(NOVEL_JS).toContain('[·•]');
  });
});

describe('quién lee qué en el hilo (audience.ts)', () => {
  it('a quién va cada frase del NPC: «a ti», «a todos», «a Mira», «a Mira y a ti»', async () => {
    const { engine } = await bootEngine(fakeTime());
    const w = engine.world;
    w.character('ch_mira').location = { type: 'spot', id: 'sp_tab_barra' };
    expect(toLabel(w, 'ch_kael', 'ch_kael', 'loc_taberna')).toBe('ti');
    expect(toLabel(w, 'ch_kael', 'all', 'loc_taberna')).toBe('todos');
    expect(toLabel(w, 'ch_kael', 'ch_mira', 'loc_taberna')).toBe('Mira');
    expect(toLabel(w, 'ch_kael', ['ch_kael', 'ch_mira'], 'loc_taberna')).toBe('Mira y a ti');
    expect(toLabel(w, 'ch_kael', undefined, 'loc_taberna')).toBe('');
  });

  it('lo que no comparte, aviso gris de una línea; lo suyo y lo de la charla, narración con sus burbujas', () => {
    const e = { action_type: 'master', actor_id: 'a', narration_private: 'Brenna deja el trapo.', observable: 'Kael habla con Brenna en voz baja.',
      payload: { audience: 'group', audience_ids: ['b'], lines: [{ speaker: 'npc', npc_id: 'npc_brenna', text: '¿Qué te pongo?' }] } };
    expect(noticeOf(e, 'c', 'Kael habla con Brenna en voz baja.')).toEqual({ text: 'Kael habla con Brenna en voz baja' });
    expect(noticeOf(e, 'b', 'Kael habla con Brenna en voz baja.')).toBeNull();
    expect(noticeOf(e, 'a')).toBeNull();
    // Algo para todos: narración para todos los presentes.
    expect(noticeOf({ ...e, payload: { ...e.payload, audience: 'present', audience_ids: ['b', 'c'] } }, 'c', 'Brenna se vuelve hacia todos.')).toBeNull();
  });

  it('la web pinta «Unirme» bajo el aviso y deja el botón solo en el último aviso de esa charla', () => {
    expect(NOVEL_JS).toContain("jr.className = 'actions party join'");
    expect(NOVEL_JS).toContain("old.getAttribute('data-npc') !== m.join.npc");
    expect(NOVEL_JS).not.toContain('overheard');
  });
});
