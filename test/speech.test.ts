import { describe, expect, it } from 'vitest';
import { speechChunks, speechMarkup, speechParts, speechText } from '../src/ai/speech.js';
import { TTS_SHARED } from '../src/adapters/web/tts.js';

describe('speechMarkup', () => {
  it('quita negritas, viñetas, iconos y atajos', () => {
    const t = speechMarkup('📜 Tablón:\n• **Leña para la posada** — diez leños. ✓\nUsa /look o /tablon para verlo. ⏳');
    expect(t).not.toMatch(/[📜•*✓⏳]/u);
    expect(t).not.toMatch(/\/look|\/tablon/);
    expect(t).toContain('Leña para la posada');
  });

  it('lee dados y siglas de reglas', () => {
    const t = speechMarkup('🎲 Percepción: 1d20+2 = 14 → éxito (CD 12). Le quedan 7 PG.');
    expect(t).toContain('1 de 20 más 2, total 14, éxito');
    expect(t).toContain('dificultad 12');
    expect(t).toContain('7 puntos de golpe');
  });
});

describe('speechParts', () => {
  it('separa el diálogo con rayas y la acotación del narrador', () => {
    const parts = speechParts('—Bienvenidos a la Croqueta —dice el tabernero—. Sentaos donde queráis.');
    expect(parts.map((p) => [p.kind, p.text])).toEqual([
      ['dialogue', 'Bienvenidos a la Croqueta.'],
      ['narrator', 'dice el tabernero.'],
      ['dialogue', 'Sentaos donde queráis.'],
    ]);
  });

  it('el diálogo tras dos puntos y las comillas latinas', () => {
    const parts = speechParts('Brenna levanta la vista: —¿Otra vez tú?\n\nEl viejo sonríe. «Pasa, forastero», murmura.');
    expect(parts.map((p) => p.kind)).toEqual(['narrator', 'dialogue', 'narrator', 'dialogue', 'narrator']);
    expect(parts[1].text).toBe('¿Otra vez tú?');
    expect(parts[2].para).toBe(true);
    expect(parts[3].text).toBe('Pasa, forastero.');
  });

  it('una raya en mitad de la narración es un inciso, no un diálogo', () => {
    const parts = speechParts('El bosque —oscuro y húmedo— calla a tu alrededor.');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ kind: 'narrator', text: 'El bosque, oscuro y húmedo, calla a tu alrededor.' });
  });

  it('pone hablante a cada parlamento con las lines del modo novela', () => {
    const parts = speechParts(
      'Doro se cruza de brazos. «Nadie sale después del toque», gruñe. Brenna ríe: «Déjalo, Doro.»',
      [{ speaker: 'npc', npc_id: 'npc_doro', text: 'Nadie sale después del toque' }, { speaker: 'npc', npc_id: 'npc_brenna', name: 'Brenna', text: 'Déjalo, Doro.' }],
    );
    const said = parts.filter((p) => p.kind === 'dialogue');
    expect(said.map((p) => p.speaker)).toEqual(['npc_doro', 'Brenna']);
  });

  it('un parlamento partido por la acotación conserva el hablante', () => {
    const parts = speechParts('—Déjalo, Doro —ríe Brenna—. Es solo una chica con un hacha.', [{ speaker: 'npc', name: 'Brenna', text: 'Déjalo, Doro. Es solo una chica con un hacha.' }]);
    expect(parts.map((p) => [p.kind, p.speaker])).toEqual([['dialogue', 'Brenna'], ['narrator', null], ['dialogue', 'Brenna']]);
  });
});

describe('speechText', () => {
  it('convierte rayas en pausas y separa párrafos', () => {
    const t = speechText('La puerta cruje.\n\n—¿Quién va? —pregunta una voz—. Identificaos.');
    expect(t).toBe('La puerta cruje.\n\n¿Quién va? pregunta una voz. Identificaos.');
    expect(t).not.toContain('—');
  });

  it('une líneas sueltas como frases', () => {
    expect(speechText('Sin camino\nSolo niebla')).toBe('Sin camino. Solo niebla.');
  });
});

describe('speechChunks', () => {
  it('corta por frases sin pasar del máximo', () => {
    const text = 'Una frase corta. ' + 'Otra frase bastante más larga que sigue y sigue, con comas, y más palabras todavía. '.repeat(4);
    const chunks = speechChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.trim().replace(/\s+/g, ' '));
  });
});

describe('copia incrustada en la página', () => {
  it('funciona fuera del módulo, como en el navegador', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const lib = new Function(TTS_SHARED + '\nreturn { speechParts: speechParts, speechText: speechText, speechChunks: speechChunks };')() as {
      speechParts: typeof speechParts; speechText: typeof speechText; speechChunks: typeof speechChunks;
    };
    const raw = '—Hola —dijo él—. Pasa.\n\n🎲 **Ataque**: 1d20+3 → impacta';
    expect(lib.speechText(raw)).toBe(speechText(raw));
    expect(lib.speechParts(raw)).toEqual(speechParts(raw));
    expect(lib.speechChunks('A. B.', 50)).toEqual(['A. B.']);
  });
});
