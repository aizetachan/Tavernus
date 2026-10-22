import { describe, it, expect } from 'vitest';
import { normalizeDictation, VOICE_SCRIPT, VOICE_STYLE } from '../src/adapters/web/voice-input.js';
import { PAGE } from '../src/adapters/web/page.js';

describe('normalizeDictation', () => {
  it('quita muletillas iniciales, también encadenadas', () => {
    expect(normalizeDictation('eh abro la puerta')).toBe('Abro la puerta');
    expect(normalizeDictation('vale, ataco al goblin')).toBe('Ataco al goblin');
    expect(normalizeDictation('Ehh, vale... pues hablo con el tabernero')).toBe('Hablo con el tabernero');
    expect(normalizeDictation('mmm bueno miro debajo de la mesa')).toBe('Miro debajo de la mesa');
  });

  it('no toca palabras que solo empiezan como una muletilla', () => {
    expect(normalizeDictation('valeria me sigue')).toBe('Valeria me sigue');
    expect(normalizeDictation('me escondo')).toBe('Me escondo');
    expect(normalizeDictation('puesto que llueve, entro')).toBe('Puesto que llueve, entro');
  });

  it('si solo hay muletilla, la deja', () => {
    expect(normalizeDictation('vale')).toBe('Vale');
  });

  it('pone mayúscula inicial saltando signos de apertura', () => {
    expect(normalizeDictation('¿quién anda ahí?')).toBe('¿Quién anda ahí?');
    expect(normalizeDictation('  ábrete   sésamo ')).toBe('Ábrete sésamo');
  });

  it('convierte «barra look» y «comando …» en los atajos', () => {
    expect(normalizeDictation('barra look')).toBe('/look');
    expect(normalizeDictation('Barra Luke.')).toBe('/look');
    expect(normalizeDictation('comando inventario')).toBe('/inventory');
    expect(normalizeDictation('eh, barra dónde')).toBe('/where');
    expect(normalizeDictation('barra tablón')).toBe('/tablon');
    expect(normalizeDictation('comando progreso')).toBe('/progress');
    expect(normalizeDictation('barra desconocido')).toBe('/desconocido');
  });

  it('no convierte «barra» en mitad de una frase', () => {
    expect(normalizeDictation('salto la barra del bar')).toBe('Salto la barra del bar');
  });

  it('«tira los dados» queda como la tirada que entiende el chat', () => {
    expect(normalizeDictation('tira los dados')).toBe('tirar');
    expect(normalizeDictation('vale, tirar')).toBe('tirar');
  });

  it('vacío se queda vacío', () => {
    expect(normalizeDictation('   ')).toBe('');
  });
});

describe('página con dictado', () => {
  it('lleva los estilos y el script del micrófono, con la misma normalización', () => {
    expect(PAGE).toContain(VOICE_STYLE);
    expect(PAGE).toContain(VOICE_SCRIPT);
    expect(VOICE_SCRIPT).toContain('function normalizeDictation(raw)');
    expect(VOICE_SCRIPT).not.toContain('${');
  });
});
