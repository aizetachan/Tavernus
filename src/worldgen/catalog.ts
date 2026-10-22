/**
 * Catálogo del generador: tipos de asentamiento, lugares y papeles de NPC, por
 * género (fantasía, ciencia ficción, postapocalíptico). Extensible: un lugar
 * nuevo es una entrada en PLACES con sus puntos de plantilla; un asentamiento
 * nuevo, una entrada en SETTLEMENTS que diga qué lugares y papeles admite.
 *
 * Los tags de los puntos son las palabras que el plano generado (mapgen.ts)
 * sabe dibujar: counter, table, fireplace, well, notice, gate, road, tree,
 * water, pond, rock, bush, building, bed, stairs, trapdoor, crate, barrel,
 * chest, shelf, stool, chair, rug, dirt.
 */

import type { Tone } from './skeleton.js';

export type Genre = 'fantasy' | 'scifi' | 'postapoc';

export interface SpotTpl {
  key: string; name: string; aliases: string[]; tags: string[]; x: number; y: number;
  hidden?: boolean; dc?: number; capacity?: number; entry_cost_s?: number; terrain?: number;
  /** Cuarto de alquiler: a la vista, cerrado con llave (rooms.ts). */
  locked?: boolean;
}

export interface PlaceTpl {
  /** Nombre genérico ("el muelle"); el relleno pone el propio. */
  label: string;
  indoor: boolean;
  noise: number;
  /** Primer punto: donde se entra (y adonde llegan las salidas). */
  spots: SpotTpl[];
  /** Horas a las que tiene sentido empezar aquí (relleno offline). */
  hours?: number[];
  /** Cómo empieza alguien aquí, para el relleno offline. */
  opening?: string;
}

const S = (key: string, name: string, aliases: string[], tags: string[], x: number, y: number, extra: Partial<SpotTpl> = {}): SpotTpl =>
  ({ key, name, aliases, tags, x, y, ...extra });
const door = (name = 'la puerta') => S('puerta', name, ['puerta', 'entrada'], ['door'], 0, 0);
const P = (label: string, indoor: boolean, noise: number, spots: SpotTpl[], extra: Partial<PlaceTpl> = {}): PlaceTpl => ({ label, indoor, noise, spots, ...extra });

// ---------------------------------------------------------------------------
// Lugares
// ---------------------------------------------------------------------------

export const PLACES = {
  // --- Fantasía: asentamiento -------------------------------------------------
  inn: P('la posada', true, 0.3, [door(), S('barra', 'la barra', ['barra', 'mostrador'], ['counter'], 6, 2), S('mesas', 'las mesas', ['mesas', 'mesa'], ['table'], 8, 6),
    S('chimenea', 'la chimenea', ['chimenea', 'fuego', 'hogar'], ['fireplace'], 2, 7), S('trampilla', 'la trampilla', ['trampilla', 'sótano'], ['trapdoor'], 10, 9, { hidden: true, dc: 14, capacity: 1 }),
    S('habitacion', 'la habitación de arriba', ['habitación', 'cuarto', 'arriba'], ['bed', 'stairs'], 4, 11, { locked: true, capacity: 2, entry_cost_s: 20 })],
    { hours: [20, 21, 22], opening: 'Alguien deja caer una jarra junto a ti y el ruido corta todas las conversaciones.' }),
  square: P('la plaza', false, 0.2, [S('centro', 'el centro de la plaza', ['centro', 'plaza'], [], 14, 12), S('pozo', 'el pozo', ['pozo', 'fuente'], ['well'], 16, 9),
    S('tablon', 'el tablón', ['tablón', 'avisos'], ['notice'], 22, 4)], { hours: [9, 12, 17], opening: 'En el tablón, alguien ha clavado un aviso con tu nombre mal escrito.' }),
  market: P('el mercado', false, 0.4, [S('centro', 'el centro del mercado', ['centro', 'mercado'], [], 12, 12), S('puestos', 'los puestos', ['puestos', 'tenderetes'], ['table', 'crate'], 6, 16),
    S('bascula', 'la báscula pública', ['báscula', 'balanza'], ['table'], 18, 8), S('tablon', 'el tablón', ['tablón', 'avisos'], ['notice'], 22, 14), S('fuente', 'la fuente', ['fuente'], ['well'], 12, 4)],
    { hours: [18, 19], opening: 'El mercado está a punto de cerrar y un comerciante te pone en las manos algo que no has comprado.' }),
  town_hall: P('la casa del concejo', true, 0.1, [door(), S('despacho', 'la mesa del despacho', ['despacho', 'mesa', 'escritorio'], ['table'], 7, 5),
    S('banco', 'el banco de espera', ['banco', 'espera'], ['stool'], 2, 4), S('archivo', 'el arcón de los registros', ['arcón', 'registros', 'archivo'], ['chest'], 9, 8)],
    { hours: [10, 11], opening: 'Llevas una hora esperando en el banco y por fin dicen tu nombre.' }),
  barracks: P('el cuartel', true, 0.3, [door(), S('armero', 'el armero', ['armero', 'armas'], ['shelf'], 3, 6), S('catres', 'los catres', ['catres', 'camas'], ['bed'], 8, 8),
    S('mesa', 'la mesa del capitán', ['mesa', 'capitán'], ['table'], 9, 2)], { hours: [5, 6], opening: 'Un tambor te arranca del sueño en un catre que no es el tuyo.' }),
  jail: P('la cárcel', true, 0.1, [door(), S('celdas', 'las celdas', ['celdas', 'celda', 'barrotes'], ['bed'], 8, 6), S('carcelero', 'el banco del carcelero', ['banco', 'llaves'], ['stool'], 3, 3),
    S('cepo', 'el cepo', ['cepo'], ['rock'], 6, 10), S('fondo', 'la celda del fondo', ['celda del fondo', 'fondo'], ['bed'], 11, 9, { hidden: true, dc: 12 })],
    { hours: [4, 5, 7], opening: 'Despiertas en el suelo de una celda, con la boca seca y sin recordar cómo llegaste.' }),
  temple: P('el templo', true, 0.05, [door(), S('altar', 'el altar', ['altar'], ['table'], 6, 10), S('bancos', 'los bancos', ['bancos', 'banco'], ['stool'], 4, 5),
    S('cripta', 'la cripta', ['cripta', 'escalera'], ['stairs'], 9, 12, { hidden: true, dc: 13 })], { hours: [7, 19], opening: 'El oficio acaba y el sacerdote te mira solo a ti al decir la última palabra.' }),
  cemetery: P('el cementerio', false, 0.05, [S('verja', 'la verja', ['verja', 'entrada'], ['gate'], 0, 0), S('tumbas', 'las tumbas', ['tumbas', 'lápidas'], ['rock'], 10, 8),
    S('panteon', 'el panteón', ['panteón'], ['building'], 18, 14), S('fosa', 'la fosa abierta', ['fosa', 'hoyo'], ['dirt'], 6, 14), S('cipres', 'el ciprés', ['ciprés', 'árbol'], ['tree'], 14, 3)],
    { hours: [8, 17], opening: 'Estás en un funeral. Echan la primera palada y alguien, al otro lado de la fosa, te reconoce.' }),
  dock: P('el muelle', false, 0.4, [S('embarcadero', 'el embarcadero', ['embarcadero', 'muelle'], ['road'], 0, 0), S('amarres', 'los amarres', ['amarres', 'barcas', 'agua'], ['water'], 12, 10, { terrain: 0.5 }),
    S('redes', 'las redes tendidas', ['redes'], ['crate'], 6, 8), S('bote', 'el bote varado', ['bote', 'barca'], ['crate'], 16, 4)],
    { hours: [5, 6, 18], opening: 'Desembarcas con las piernas aún hechas al vaivén y el patrón te grita que no has pagado el pasaje entero.' }),
  fish_market: P('la lonja', true, 0.5, [door(), S('despiece', 'las mesas de despiece', ['mesas', 'despiece'], ['table'], 6, 4), S('cajas', 'las cajas de pescado', ['cajas', 'pescado'], ['crate'], 10, 8),
    S('subasta', 'el puesto de subasta', ['subasta', 'puesto'], ['counter'], 3, 9)], { hours: [5, 6], opening: 'La subasta del pescado empieza y alguien puja por ti como si fueras un lote.' }),
  lighthouse: P('el faro', true, 0.2, [door(), S('escalera', 'la escalera de caracol', ['escalera'], ['stairs'], 4, 4), S('linterna', 'la linterna', ['linterna', 'luz', 'fuego'], ['fireplace'], 6, 8),
    S('aceite', 'el almacén de aceite', ['aceite', 'almacén'], ['barrel'], 2, 8)], { hours: [21, 23], opening: 'La luz del faro se apaga contigo dentro y abajo alguien cierra la puerta con llave.' }),
  warehouse: P('el almacén', true, 0.1, [door(), S('cajas', 'las cajas apiladas', ['cajas'], ['crate'], 6, 5), S('barriles', 'los barriles', ['barriles', 'toneles'], ['barrel'], 3, 9),
    S('altillo', 'el altillo', ['altillo'], ['stairs'], 9, 9, { hidden: true, dc: 12 })], { hours: [2, 3], opening: 'Te escondes entre cajas en plena noche y oyes que alguien cuenta monedas a dos pasos.' }),
  smithy: P('la herrería', true, 0.5, [door(), S('fragua', 'la fragua', ['fragua', 'fuego'], ['fireplace'], 5, 4), S('yunque', 'el yunque', ['yunque'], ['rock'], 7, 6),
    S('banco', 'el banco de trabajo', ['banco', 'herramientas'], ['table'], 3, 8)], { hours: [8, 15], opening: 'El herrero sumerge al rojo una hoja que conoces: es la tuya, la que te robaron.' }),
  healer: P('la casa de la curandera', true, 0.05, [door(), S('hierbas', 'las hierbas colgadas', ['hierbas'], ['shelf'], 3, 5), S('camastro', 'el camastro', ['camastro', 'cama'], ['bed'], 7, 7),
    S('caldero', 'el caldero', ['caldero', 'fuego'], ['fireplace'], 5, 2)], { hours: [3, 9], opening: 'Despiertas en un camastro con una herida cosida que no recuerdas haberte hecho.' }),
  exchange: P('la casa de cambio', true, 0.1, [door(), S('mostrador', 'el mostrador', ['mostrador'], ['counter'], 5, 3), S('balanza', 'la balanza', ['balanza'], ['table'], 3, 6),
    S('caja', 'la caja fuerte', ['caja fuerte', 'caja'], ['chest'], 8, 7, { hidden: true, dc: 14 })], { hours: [11, 16], opening: 'El cambista muerde tu moneda y te la devuelve sin una palabra: es falsa.' }),
  stable: P('el establo', true, 0.3, [door(), S('cuadras', 'las cuadras', ['cuadras', 'caballos'], ['crate'], 6, 4), S('pajar', 'el pajar', ['pajar', 'paja'], ['bed'], 9, 8),
    S('abrevadero', 'el abrevadero', ['abrevadero', 'agua'], ['water'], 3, 8)], { hours: [5, 6], opening: 'Despiertas en el pajar con heno en el pelo y un caballo que no es tuyo mordiéndote la manga.' }),
  gate: P('el portón', false, 0.1, [S('calle', 'el lado de dentro', ['calle', 'dentro'], ['road'], 0, 0), S('porton', 'el portón', ['portón', 'puerta', 'salida'], ['gate'], 10, 6),
    S('garita', 'la garita', ['garita', 'caseta'], ['building'], 6, 10)], { hours: [6, 21], opening: 'Llegas al portón justo cuando están a punto de cerrarlo y el guardia te mira de arriba abajo.' }),
  watchtower: P('la atalaya', true, 0.1, [door(), S('escalera', 'la escalera', ['escalera'], ['stairs'], 3, 3), S('almenas', 'las almenas', ['almenas', 'arriba'], ['rock'], 6, 6),
    S('catre', 'el catre del vigía', ['catre'], ['bed'], 2, 7)], { hours: [0, 4], opening: 'Haces la guardia en lo alto de la atalaya y ves una luz donde no debería haber nadie.' }),
  courtyard: P('el patio de armas', false, 0.3, [S('centro', 'el centro del patio', ['patio', 'centro'], ['dirt'], 12, 10), S('pozo', 'el pozo', ['pozo'], ['well'], 6, 6),
    S('poste', 'el poste de prácticas', ['poste', 'prácticas'], ['tree'], 18, 8), S('tablon', 'el tablón de órdenes', ['tablón', 'órdenes'], ['notice'], 4, 14)],
    { hours: [6, 7], opening: 'Formas en el patio con los demás y el sargento lee tu nombre en una lista de castigados.' }),
  cloister: P('el claustro', false, 0.05, [S('arco', 'el arco de entrada', ['arco', 'entrada'], ['gate'], 0, 0), S('pozo', 'el pozo del claustro', ['pozo'], ['well'], 8, 8),
    S('naranjo', 'el naranjo', ['naranjo', 'árbol'], ['tree'], 12, 4), S('galeria', 'la galería', ['galería', 'arcos'], ['building'], 14, 12)],
    { hours: [6, 18], opening: 'Las campanas tocan a destiempo y todos los monjes se vuelven hacia ti.' }),
  monastery_gate: P('la portería del monasterio', true, 0.05, [door('el portón del monasterio'), S('torno', 'el torno', ['torno'], ['counter'], 4, 3),
    S('hospederia', 'la hospedería', ['hospedería', 'cama'], ['bed'], 8, 6)], { hours: [7, 20], opening: 'Llamas al portón del monasterio y te abren antes de que termines de llamar, como si te esperaran.' }),
  scriptorium: P('el escritorio', true, 0.02, [door(), S('atriles', 'los atriles', ['atriles', 'mesas'], ['table'], 5, 4), S('biblioteca', 'la biblioteca', ['biblioteca', 'libros'], ['shelf'], 8, 8),
    S('archivo', 'el archivo cerrado', ['archivo'], ['chest'], 10, 10, { hidden: true, dc: 14 })], { hours: [14, 22], opening: 'Copias un libro a la luz de una vela y en el margen aparece, en tu letra, algo que no has escrito.' }),
  wagon_circle: P('el corro de carros', false, 0.3, [S('hoguera', 'la hoguera del centro', ['hoguera', 'fuego'], ['fireplace'], 10, 10), S('carros', 'los carros', ['carros'], ['crate'], 4, 4),
    S('jefa', 'el carro de la jefa', ['carro grande'], ['building'], 16, 6)], { hours: [20, 21], opening: 'La caravana acampa y, al pasar lista junto a la hoguera, sobra un nombre: el tuyo.' }),
  merchant_wagon: P('el carro del mercader', true, 0.1, [door('la escalerilla'), S('fardos', 'los fardos', ['fardos'], ['crate'], 3, 3), S('arcon', 'el arcón', ['arcón'], ['chest'], 5, 2, { hidden: true, dc: 12 })],
    { hours: [10], opening: 'Despiertas entre fardos en un carro que se mueve. Fuera alguien discute qué hacer contigo.' }),
  cook_wagon: P('el carro de cocina', true, 0.2, [door('la trasera'), S('fogon', 'el fogón', ['fogón', 'fuego'], ['fireplace'], 3, 2), S('ollas', 'las ollas', ['ollas', 'despensa'], ['shelf'], 2, 4)],
    { hours: [7, 19], opening: 'El cocinero te pone un cuenco delante y susurra que no comas lo de la olla grande.' }),
  fortune_wagon: P('el carro de la adivina', true, 0.02, [door('la cortina'), S('mesa', 'la mesa de las cartas', ['mesa', 'cartas'], ['table'], 3, 3), S('baul', 'el baúl', ['baúl'], ['chest'], 4, 1)],
    { hours: [23], opening: 'La adivina vuelve la última carta y es la que lleva tu cara pintada.' }),
  animal_pen: P('el cercado', false, 0.3, [S('entrada', 'la entrada del cercado', ['entrada'], ['gate'], 0, 0), S('animales', 'los animales', ['animales', 'mulas', 'bueyes'], ['bush'], 8, 6),
    S('bebedero', 'el bebedero', ['bebedero', 'agua'], ['water'], 4, 10)], { hours: [5], opening: 'Una mula ha roto la cerca y todos te miran como si hubieras sido tú.' }),
  abandoned_street: P('la calle vacía', false, 0.02, [S('calle', 'la calle', ['calle'], ['road'], 0, 0), S('casa', 'la casa hundida', ['casa hundida', 'casa'], ['building'], 10, 6),
    S('pozo', 'el pozo cegado', ['pozo'], ['well'], 14, 12), S('carro', 'el carro roto', ['carro'], ['crate'], 6, 14)], { hours: [17, 18], opening: 'Entras en el pueblo al caer la tarde: no hay nadie, pero en una ventana tiembla una vela.' }),
  abandoned_house: P('la casa abandonada', true, 0.02, [door(), S('cocina', 'la cocina fría', ['cocina', 'hogar'], ['fireplace'], 3, 5), S('dormitorio', 'el dormitorio', ['dormitorio', 'cama'], ['bed'], 8, 7),
    S('sotano', 'el sótano', ['sótano', 'trampilla'], ['trapdoor'], 6, 10, { hidden: true, dc: 13 })], { hours: [1, 2], opening: 'Despiertas en una cama ajena, con la manta echada por encima por alguien que ya no está.' }),
  cave_hall: P('la gran caverna', true, 0.2, [S('entrada', 'la entrada de la caverna', ['entrada', 'boca'], ['road'], 0, 0), S('hoguera', 'la hoguera', ['hoguera', 'fuego'], ['fireplace'], 8, 8),
    S('jergones', 'los jergones', ['jergones', 'camas'], ['bed'], 14, 6), S('manantial', 'el manantial', ['manantial', 'agua'], ['water'], 12, 14)],
    { hours: [19, 20], opening: 'Te traen a la caverna con los ojos vendados y te quitan la venda junto a la hoguera.' }),
  cave_shrine: P('la gruta sagrada', true, 0.02, [S('entrada', 'la entrada de la gruta', ['entrada'], ['road'], 0, 0), S('altar', 'el altar de piedra', ['altar'], ['table'], 6, 6),
    S('pinturas', 'las pinturas de la pared', ['pinturas', 'pared'], ['rock'], 10, 4), S('grieta', 'la grieta', ['grieta'], ['rock'], 12, 10, { hidden: true, dc: 14 })],
    { hours: [0], opening: 'En las pinturas de la gruta hay una figura que lleva exactamente tu ropa.' }),
  mine_mouth: P('la bocamina', false, 0.4, [S('entrada', 'la entrada de la mina', ['entrada', 'bocamina'], ['road'], 0, 0), S('vagonetas', 'las vagonetas', ['vagonetas'], ['crate'], 8, 4),
    S('cabrestante', 'el cabrestante', ['cabrestante'], ['barrel'], 12, 8), S('caseta', 'la caseta del capataz', ['caseta'], ['building'], 4, 12)],
    { hours: [6, 7], opening: 'Sales de la mina al amanecer, negro de polvo, y el capataz te está esperando con una lista en la mano.' }),
  mine_gallery: P('la galería de la mina', true, 0.2, [S('boca', 'la boca de la galería', ['boca', 'galería'], ['road'], 0, 0), S('veta', 'la veta', ['veta', 'pared'], ['rock'], 10, 4),
    S('pozo', 'el pozo de ventilación', ['pozo'], ['well'], 6, 10), S('derrumbe', 'el derrumbe', ['derrumbe'], ['rock'], 14, 12, { hidden: true, dc: 13 })],
    { hours: [3, 14], opening: 'La lámpara parpadea y, al fondo de la galería, alguien golpea la roca desde el otro lado.' }),
  // --- Ciencia ficción ---------------------------------------------------------
  spaceport: P('el puerto espacial', false, 0.6, [S('plataforma', 'la plataforma de aterrizaje', ['plataforma', 'pista'], ['road'], 0, 0), S('torre', 'la torre de control', ['torre', 'control'], ['building'], 16, 6),
    S('contenedores', 'los contenedores', ['contenedores'], ['crate'], 8, 12), S('aduana', 'la aduana', ['aduana', 'control'], ['counter'], 4, 6)],
    { hours: [6, 23], opening: 'Bajas por la rampa de la nave y un dron de aduanas te escanea dos veces, la segunda en rojo.' }),
  cantina: P('la cantina', true, 0.5, [door(), S('barra', 'la barra', ['barra'], ['counter'], 6, 2), S('mesas', 'las mesas', ['mesas', 'mesa'], ['table'], 8, 6),
    S('reservado', 'el reservado', ['reservado'], ['table', 'stool'], 11, 8), S('conducto', 'el conducto de ventilación', ['conducto'], ['trapdoor'], 2, 9, { hidden: true, dc: 13 })],
    { hours: [22, 23], opening: 'La música de la cantina se corta en seco y todas las miradas van a la puerta, a ti.' }),
  hangar: P('el hangar', true, 0.6, [S('compuerta', 'la compuerta del hangar', ['compuerta', 'puerta'], ['gate'], 0, 0), S('nave', 'la nave en reparación', ['nave'], ['building'], 12, 8),
    S('herramientas', 'los bancos de herramientas', ['herramientas', 'banco'], ['table'], 4, 10), S('combustible', 'el depósito de combustible', ['combustible', 'depósito'], ['barrel'], 16, 2)],
    { hours: [2, 13], opening: 'Despiertas dentro de una cápsula de carga abierta en mitad del hangar.' }),
  habitat_ring: P('el anillo habitable', true, 0.3, [S('corredor', 'el corredor', ['corredor', 'pasillo'], ['road'], 0, 0), S('capsulas', 'las cápsulas de dormir', ['cápsulas', 'literas'], ['bed'], 8, 4),
    S('comedor', 'el comedor', ['comedor', 'mesas'], ['table'], 12, 10), S('esclusa', 'la esclusa', ['esclusa'], ['gate'], 2, 12)], { hours: [7, 0], opening: 'Tu cápsula de dormir se abre sola tres horas antes de tu turno.' }),
  security_office: P('la oficina de seguridad', true, 0.2, [door(), S('consola', 'la consola', ['consola', 'pantallas'], ['table'], 5, 3), S('calabozo', 'el calabozo', ['calabozo', 'celda'], ['bed'], 9, 7),
    S('armero', 'el armero', ['armero'], ['shelf'], 2, 7)], { hours: [3, 9], opening: 'Despiertas en el calabozo de seguridad. La puerta está abierta y no hay nadie vigilando.' }),
  med_bay: P('la enfermería', true, 0.1, [door(), S('camillas', 'las camillas', ['camillas', 'camilla'], ['bed'], 6, 4), S('botiquin', 'el armario de fármacos', ['fármacos', 'armario'], ['shelf'], 2, 6),
    S('consola', 'la consola médica', ['consola'], ['table'], 9, 7)], { hours: [4, 15], opening: 'Despiertas en una camilla con un implante nuevo en la nuca y ningún recuerdo de la operación.' }),
  market_deck: P('la cubierta del mercado', false, 0.5, [S('centro', 'el centro de la cubierta', ['centro', 'mercado'], [], 12, 12), S('puestos', 'los puestos', ['puestos'], ['table', 'crate'], 6, 16),
    S('tablon', 'el panel de anuncios', ['panel', 'anuncios'], ['notice'], 20, 6), S('agua', 'la fuente de agua reciclada', ['fuente', 'agua'], ['well'], 14, 4)],
    { hours: [17, 18], opening: 'Un vendedor te agarra del brazo: dice que ayer le compraste algo y que vuelves a deberle.' }),
  mine_shaft: P('el pozo de extracción', true, 0.5, [S('elevador', 'el elevador', ['elevador', 'ascensor'], ['road'], 0, 0), S('perforadora', 'la perforadora', ['perforadora', 'máquina'], ['barrel'], 10, 6),
    S('veta', 'la veta de mineral', ['veta', 'mineral'], ['rock'], 14, 12), S('refugio', 'el refugio presurizado', ['refugio'], ['building'], 4, 12, { hidden: true, dc: 12 })],
    { hours: [6, 18], opening: 'Subes en el elevador al cambio de turno y el contador de oxígeno marca menos de lo que debería.' }),
  // --- Postapocalíptico --------------------------------------------------------
  shelter: P('el refugio', true, 0.2, [S('compuerta', 'la puerta blindada', ['puerta', 'compuerta'], ['gate'], 0, 0), S('literas', 'las literas', ['literas', 'camas'], ['bed'], 8, 4),
    S('despensa', 'la despensa', ['despensa', 'víveres'], ['shelf'], 3, 8), S('generador', 'el generador', ['generador'], ['barrel'], 10, 10)],
    { hours: [6, 22], opening: 'El generador del refugio tose y se para, y en la oscuridad alguien dice tu nombre.' }),
  scrap_market: P('el mercado de chatarra', false, 0.5, [S('centro', 'el centro del mercado', ['centro', 'mercado'], [], 12, 12), S('puestos', 'los puestos', ['puestos'], ['table', 'crate'], 6, 16),
    S('montón', 'el montón de chatarra', ['chatarra', 'montón'], ['rock'], 18, 6), S('bidon', 'el bidón con fuego', ['bidón', 'fuego'], ['fireplace'], 10, 4), S('tablon', 'el tablón', ['tablón', 'avisos'], ['notice'], 22, 14)],
    { hours: [16, 19], opening: 'Cambias tu última lata por agua y el vendedor se fija demasiado en la marca de tu muñeca.' }),
  water_tower: P('el depósito de agua', false, 0.2, [S('base', 'la base del depósito', ['base'], ['road'], 0, 0), S('escalera', 'la escalera', ['escalera'], ['stairs'], 4, 6),
    S('tanque', 'el tanque', ['tanque', 'agua'], ['water'], 8, 8), S('valvula', 'la válvula', ['válvula', 'grifo'], ['barrel'], 12, 4)], { hours: [5], opening: 'Haces cola para el agua al alba y el grifo se cierra justo al llegarte el turno.' }),
  garage: P('el taller', true, 0.5, [door('el portalón'), S('coches', 'los coches desguazados', ['coches', 'chatarra'], ['crate'], 8, 6), S('banco', 'el banco de trabajo', ['banco', 'herramientas'], ['table'], 3, 4),
    S('foso', 'el foso', ['foso'], ['trapdoor'], 10, 10, { hidden: true, dc: 12 })], { hours: [10, 15], opening: 'Despiertas debajo de un coche a medio arreglar, con una llave inglesa en la mano y sangre que no es tuya.' }),
  barricade: P('la barricada', false, 0.2, [S('dentro', 'el lado de dentro', ['dentro'], ['road'], 0, 0), S('paso', 'el paso de la barricada', ['paso', 'puerta', 'salida'], ['gate'], 10, 6),
    S('sacos', 'los sacos terreros', ['sacos'], ['crate'], 6, 10), S('torreta', 'la torreta', ['torreta'], ['building'], 14, 10)],
    { hours: [4, 20], opening: 'Llegas a la barricada con las manos en alto y alguien arriba no decide si disparar.' }),
  clinic: P('la clínica', true, 0.1, [door(), S('camillas', 'las camillas', ['camillas'], ['bed'], 6, 4), S('botiquin', 'el botiquín', ['botiquín', 'medicinas'], ['shelf'], 2, 6),
    S('mesa', 'la mesa de operaciones', ['mesa'], ['table'], 9, 7)], { hours: [3], opening: 'Despiertas atado a una camilla. Te han quitado algo y te han dejado la factura.' }),
  // --- Exteriores --------------------------------------------------------------
  forest: P('el bosque', false, 0.1, [S('sendero', 'el sendero', ['sendero', 'camino'], ['road'], 0, 0), S('arbol', 'el árbol viejo', ['árbol', 'árbol viejo'], ['tree', 'climbable', 'cover'], 22, 14),
    S('zarzas', 'los zarzales', ['zarzas', 'zarzales', 'bayas'], ['bush'], 12, 20), S('piedra', 'la piedra grande', ['piedra', 'roca'], ['rock'], 30, 6)], { hours: [6, 18], opening: 'Bajas del monte con hambre y oyes, muy cerca, un silbido que se repite.' }),
  river: P('el río', false, 0.25, [S('orilla', 'la orilla', ['orilla', 'camino'], ['road'], 0, 0), S('vado', 'el vado', ['vado', 'río', 'agua'], ['water'], 20, 8, { terrain: 0.5 }),
    S('sauce', 'el sauce', ['sauce', 'árbol'], ['tree', 'cover'], 10, 14), S('rocas', 'las rocas', ['rocas', 'piedras'], ['rock'], 26, 16)], { hours: [7], opening: 'El río te deja en la orilla, empapado, con una cuerda cortada atada a la cintura.' }),
  ruin: P('las ruinas', false, 0.05, [S('senda', 'la senda', ['senda', 'camino'], ['road'], 0, 0), S('muro', 'el muro caído', ['muro', 'ruinas'], ['rock', 'cover'], 14, 10),
    S('torre', 'la torre derruida', ['torre'], ['building'], 24, 16), S('zarzas', 'los zarzales', ['zarzas', 'arbustos'], ['bush'], 8, 18), S('boveda', 'la bóveda', ['bóveda', 'escalera'], ['stairs'], 26, 20, { hidden: true, dc: 15 })],
    { hours: [16], opening: 'Te despiertas a la sombra del muro caído con un mapa en la mano que no sabes leer.' }),
  crossroads: P('el cruce de caminos', false, 0.1, [S('cruce', 'el cruce', ['cruce', 'camino'], ['road'], 0, 0), S('mojon', 'el mojón', ['mojón', 'piedra'], ['rock'], 6, 6),
    S('encina', 'la encina', ['encina', 'árbol'], ['tree', 'cover'], 16, 12), S('abrevadero', 'el abrevadero', ['abrevadero', 'agua'], ['water'], 24, 4)], { hours: [12], opening: 'En el cruce hay un ahorcado nuevo, y lleva tu capa.' }),
  coast: P('la costa', false, 0.4, [S('playa', 'la playa', ['playa', 'arena'], ['road'], 0, 0), S('rocas', 'las rocas', ['rocas', 'acantilado'], ['rock'], 14, 6),
    S('rompiente', 'la rompiente', ['agua', 'olas', 'mar'], ['water'], 22, 12, { terrain: 0.5 }), S('cueva', 'la cueva marina', ['cueva'], ['rock'], 18, 2, { hidden: true, dc: 13 })],
    { hours: [6], opening: 'El mar te ha escupido en la playa entre restos de un barco que no recuerdas.' }),
  hills: P('las colinas', false, 0.1, [S('camino', 'el camino de las colinas', ['camino'], ['road'], 0, 0), S('cumbre', 'la cumbre pelada', ['cumbre', 'cima'], ['rock'], 18, 10),
    S('matorral', 'el matorral', ['matorral', 'bayas'], ['bush'], 8, 14), S('encina', 'la encina solitaria', ['encina', 'árbol'], ['tree'], 24, 4)], { hours: [9], opening: 'Desde la cumbre ves humo donde no debería haberlo, y un jinete que sube hacia ti al galope.' }),
  swamp: P('la ciénaga', false, 0.15, [S('pasarela', 'la pasarela', ['pasarela', 'tablones'], ['road'], 0, 0), S('charca', 'la charca', ['charca', 'agua'], ['pond'], 12, 8, { terrain: 0.5 }),
    S('juncos', 'los juncos', ['juncos', 'cañas'], ['bush'], 6, 14), S('tronco', 'el tronco caído', ['tronco'], ['tree'], 18, 14)], { hours: [5], opening: 'Despiertas con el barro hasta las rodillas y una cuerda atada al tobillo que se pierde en la charca.' }),
  mountain_pass: P('el paso de montaña', false, 0.2, [S('camino', 'el camino del paso', ['camino', 'paso'], ['road'], 0, 0), S('roca', 'la roca partida', ['roca'], ['rock'], 12, 6),
    S('abrigo', 'el abrigo de pastores', ['abrigo', 'refugio'], ['building'], 18, 12), S('pinos', 'los pinos', ['pinos', 'árboles'], ['tree'], 6, 14)], { hours: [10], opening: 'Bajas del paso con la nieve en las botas y encuentras una mula cargada, sin dueño, que te sigue.' }),
  wasteland: P('la llanura de polvo', false, 0.3, [S('ruta', 'la ruta marcada', ['ruta', 'camino'], ['road'], 0, 0), S('rocas', 'las rocas', ['rocas'], ['rock'], 14, 8),
    S('crater', 'el cráter', ['cráter'], ['pond'], 22, 14), S('sonda', 'los restos de la sonda', ['restos', 'sonda'], ['crate'], 8, 16)], { hours: [12], opening: 'Tu traje marca dos horas de aire y la baliza de los restos acaba de encenderse sola.' }),
  derelict: P('el pecio', true, 0.05, [S('brecha', 'la brecha del casco', ['brecha', 'entrada'], ['road'], 0, 0), S('puente', 'el puente de mando', ['puente', 'mando'], ['table'], 12, 6),
    S('bodega', 'la bodega', ['bodega', 'carga'], ['crate'], 8, 12), S('camara', 'la cámara sellada', ['cámara'], ['chest'], 16, 14, { hidden: true, dc: 15 })], { hours: [0], opening: 'Las luces de emergencia del pecio parpadean y algo golpea el casco desde dentro.' }),
  highway: P('la autopista rota', false, 0.2, [S('carril', 'el carril', ['carril', 'carretera'], ['road'], 0, 0), S('coches', 'los coches abandonados', ['coches'], ['crate'], 12, 6),
    S('puente', 'el puente caído', ['puente'], ['rock'], 22, 12), S('matojos', 'los matojos', ['matojos', 'arbustos'], ['bush'], 6, 14)], { hours: [14], opening: 'El motor de tu moto muere en mitad de la autopista y oyes otro motor que se acerca.' }),
  dead_city: P('las ruinas de la ciudad', false, 0.05, [S('avenida', 'la avenida', ['avenida', 'calle'], ['road'], 0, 0), S('edificio', 'el edificio hueco', ['edificio'], ['building'], 14, 8),
    S('cascotes', 'los cascotes', ['cascotes'], ['rock'], 8, 14), S('sotano', 'el sótano', ['sótano'], ['stairs'], 18, 16, { hidden: true, dc: 13 })], { hours: [17], opening: 'Sales de entre los cascotes con la mochila llena y alguien, desde una ventana, te silba.' }),
} satisfies Record<string, PlaceTpl>;

export type PlaceKind = keyof typeof PLACES;

// ---------------------------------------------------------------------------
// Papeles de NPC
// ---------------------------------------------------------------------------

export type Archetype = 'commoner' | 'guard' | 'noble' | 'acolyte' | 'bandit' | 'scout' | 'thug' | 'priest' | 'veteran' | 'mage' | 'wolf' | 'boar';

export interface RoleDef {
  /** Papel en castellano para el relleno y el máster. */
  label: string;
  archetype: Archetype;
  /** Dónde vive, por orden de preferencia; si no hay ninguno, en el centro. */
  homes: PlaceKind[];
  /** Punto preferido dentro de su lugar (clave de plantilla). */
  spot?: string;
}

const R = (label: string, archetype: Archetype, homes: PlaceKind[], spot?: string): RoleDef => ({ label, archetype, homes, ...(spot ? { spot } : {}) });

export const ROLES = {
  innkeeper: R('posadero', 'commoner', ['inn'], 'barra'),
  mayor: R('alcalde', 'noble', ['town_hall'], 'despacho'),
  guard: R('guardia', 'guard', ['gate', 'barricade', 'barracks'], 'porton'),
  priest: R('sacerdote', 'priest', ['temple', 'cemetery'], 'altar'),
  smith: R('herrero', 'thug', ['smithy'], 'fragua'),
  healer: R('curandera', 'acolyte', ['healer', 'clinic', 'med_bay'], 'camastro'),
  gravedigger: R('enterrador', 'commoner', ['cemetery'], 'fosa'),
  stableboy: R('mozo de cuadra', 'commoner', ['stable', 'animal_pen'], 'cuadras'),
  stranger: R('forastero', 'scout', ['inn', 'cantina', 'market', 'square'], 'mesas'),
  boat_master: R('patrón de barco', 'bandit', ['dock'], 'amarres'),
  fishmonger: R('lonjera', 'commoner', ['fish_market'], 'subasta'),
  lighthouse_keeper: R('farera', 'commoner', ['lighthouse'], 'linterna'),
  smuggler: R('contrabandista', 'bandit', ['warehouse', 'dock', 'cantina'], 'cajas'),
  captain: R('capitana de la guardia', 'veteran', ['barracks', 'courtyard', 'gate'], 'mesa'),
  sergeant: R('sargento', 'guard', ['courtyard', 'barracks'], 'centro'),
  jailer: R('carcelero', 'guard', ['jail'], 'carcelero'),
  prisoner: R('preso', 'commoner', ['jail'], 'celdas'),
  money_changer: R('cambista', 'noble', ['exchange'], 'mostrador'),
  merchant: R('mercader', 'commoner', ['market', 'merchant_wagon', 'square', 'scrap_market', 'market_deck'], 'puestos'),
  thief: R('ladrona', 'bandit', ['market', 'square', 'scrap_market'], 'puestos'),
  foreman: R('capataz', 'thug', ['mine_mouth', 'mine_shaft'], 'caseta'),
  miner: R('minera', 'commoner', ['mine_gallery', 'mine_shaft'], 'veta'),
  paymaster: R('pagador', 'commoner', ['warehouse', 'mine_mouth'], 'cajas'),
  abbot: R('abad', 'priest', ['cloister', 'temple'], 'galeria'),
  porter: R('hermano portero', 'acolyte', ['monastery_gate'], 'torno'),
  librarian: R('bibliotecaria', 'acolyte', ['scriptorium'], 'biblioteca'),
  pilgrim: R('peregrino', 'commoner', ['monastery_gate', 'cloister', 'inn'], 'hospederia'),
  caravan_boss: R('jefa de caravana', 'veteran', ['wagon_circle'], 'jefa'),
  cook: R('cocinero', 'commoner', ['cook_wagon', 'inn'], 'fogon'),
  fortune_teller: R('adivina', 'mage', ['fortune_wagon'], 'mesa'),
  escort: R('escolta', 'guard', ['wagon_circle', 'animal_pen'], 'carros'),
  scavenger: R('chatarrero', 'scout', ['abandoned_street', 'scrap_market', 'garage'], 'carro'),
  hermit: R('ermitaño', 'acolyte', ['abandoned_house', 'cave_shrine', 'temple'], 'cocina'),
  survivor: R('superviviente', 'commoner', ['abandoned_house', 'shelter', 'abandoned_street'], 'dormitorio'),
  hunter: R('cazadora', 'scout', ['cave_hall', 'abandoned_street', 'stable'], 'hoguera'),
  elder: R('anciana', 'commoner', ['cave_hall', 'town_hall', 'shelter'], 'hoguera'),
  sorceress: R('hechicera', 'mage', ['cave_shrine', 'fortune_wagon', 'healer'], 'altar'),
  sentinel: R('centinela', 'guard', ['watchtower', 'barricade', 'gate'], 'almenas'),
  chaplain: R('capellán', 'priest', ['temple'], 'altar'),
  port_master: R('jefa de puerto', 'noble', ['spaceport'], 'torre'),
  bartender: R('cantinero', 'commoner', ['cantina'], 'barra'),
  mechanic: R('mecánica', 'commoner', ['hangar', 'garage'], 'herramientas'),
  security_agent: R('agente de seguridad', 'guard', ['security_office'], 'consola'),
  medic: R('médico', 'acolyte', ['med_bay', 'clinic'], 'consola'),
  shelter_boss: R('jefa del refugio', 'veteran', ['shelter'], 'generador'),
  water_keeper: R('guardián del agua', 'thug', ['water_tower'], 'valvula'),
} satisfies Record<string, RoleDef>;

export type RoleId = keyof typeof ROLES;

// ---------------------------------------------------------------------------
// Tipos de asentamiento
// ---------------------------------------------------------------------------

export interface SettlementDef {
  label: string;
  genre: Genre;
  /** Lugares que siempre hay (el primero es el centro, adonde da todo). */
  required: PlaceKind[];
  /** De entre estos se eligen los que falten hasta [min, max] lugares. */
  optional: PlaceKind[];
  places: [number, number];
  /** Papeles: los fijos y la bolsa de la que salen los demás, hasta [min, max] NPC. */
  roles_required: RoleId[];
  roles_optional: RoleId[];
  npcs: [number, number];
  /** Exteriores posibles (se eligen dos distintos). */
  wild: PlaceKind[];
  /** Peso por tono (1 si no se dice). */
  weight?: Partial<Record<Tone, number>>;
  /** Bestias posibles en los exteriores (o ninguna). */
  beasts?: ('wolf' | 'boar')[];
}

export const SETTLEMENTS = {
  village: { label: 'aldea', genre: 'fantasy', required: ['square'], optional: ['inn', 'temple', 'smithy', 'town_hall', 'healer', 'stable', 'cemetery', 'gate'], places: [4, 6],
    roles_required: ['mayor'], roles_optional: ['innkeeper', 'smith', 'priest', 'healer', 'guard', 'stranger', 'stableboy', 'gravedigger'], npcs: [4, 6],
    wild: ['forest', 'river', 'crossroads', 'hills', 'swamp'], weight: { comedy: 2, grim: 1 }, beasts: ['wolf', 'boar'] },
  fishing_port: { label: 'puerto pesquero', genre: 'fantasy', required: ['dock', 'fish_market'], optional: ['inn', 'lighthouse', 'warehouse', 'temple', 'healer', 'square'], places: [4, 6],
    roles_required: ['boat_master', 'fishmonger'], roles_optional: ['lighthouse_keeper', 'smuggler', 'innkeeper', 'healer', 'priest', 'stranger'], npcs: [4, 6],
    wild: ['coast', 'river', 'swamp'], weight: { pulp: 2, horror: 2 } },
  walled_city: { label: 'ciudad amurallada', genre: 'fantasy', required: ['market', 'gate', 'town_hall'], optional: ['inn', 'barracks', 'jail', 'temple', 'exchange', 'smithy', 'cemetery', 'warehouse'], places: [5, 6],
    roles_required: ['captain', 'mayor'], roles_optional: ['money_changer', 'jailer', 'priest', 'innkeeper', 'merchant', 'thief', 'prisoner', 'smith'], npcs: [5, 7],
    wild: ['river', 'crossroads', 'hills', 'forest'], weight: { epic: 3, pulp: 2 } },
  mining_camp: { label: 'campamento minero', genre: 'fantasy', required: ['mine_mouth', 'mine_gallery'], optional: ['inn', 'smithy', 'warehouse', 'healer', 'jail'], places: [4, 5],
    roles_required: ['foreman', 'miner'], roles_optional: ['smith', 'healer', 'cook', 'paymaster', 'jailer', 'stranger'], npcs: [4, 6],
    wild: ['hills', 'mountain_pass', 'forest'], weight: { grim: 3, pulp: 2 }, beasts: ['wolf'] },
  monastery: { label: 'monasterio', genre: 'fantasy', required: ['cloister', 'monastery_gate'], optional: ['temple', 'scriptorium', 'cemetery', 'healer', 'stable'], places: [4, 5],
    roles_required: ['abbot', 'porter'], roles_optional: ['librarian', 'healer', 'pilgrim', 'gravedigger', 'stableboy'], npcs: [4, 6],
    wild: ['mountain_pass', 'forest', 'hills'], weight: { horror: 3, grim: 2 }, beasts: ['wolf'] },
  caravan: { label: 'caravana en marcha', genre: 'fantasy', required: ['wagon_circle', 'merchant_wagon'], optional: ['cook_wagon', 'fortune_wagon', 'animal_pen'], places: [4, 5],
    roles_required: ['caravan_boss', 'merchant'], roles_optional: ['cook', 'fortune_teller', 'escort', 'stableboy', 'stranger'], npcs: [4, 6],
    wild: ['crossroads', 'river', 'forest', 'hills'], weight: { pulp: 3, comedy: 2, epic: 1 }, beasts: ['wolf', 'boar'] },
  border_fortress: { label: 'fortaleza fronteriza', genre: 'fantasy', required: ['courtyard', 'gate', 'barracks'], optional: ['watchtower', 'jail', 'smithy', 'temple', 'warehouse'], places: [4, 6],
    roles_required: ['captain', 'sergeant'], roles_optional: ['jailer', 'smith', 'chaplain', 'sentinel', 'prisoner'], npcs: [4, 6],
    wild: ['mountain_pass', 'forest', 'river', 'hills'], weight: { epic: 3, grim: 2 }, beasts: ['wolf'] },
  crossroads_market: { label: 'mercado de cruce de caminos', genre: 'fantasy', required: ['market', 'inn'], optional: ['exchange', 'stable', 'warehouse', 'smithy', 'temple', 'healer'], places: [4, 6],
    roles_required: ['merchant', 'innkeeper'], roles_optional: ['money_changer', 'stableboy', 'thief', 'smith', 'healer', 'stranger', 'smuggler'], npcs: [4, 6],
    wild: ['crossroads', 'river', 'forest', 'hills'], weight: { comedy: 3, pulp: 2 }, beasts: ['boar'] },
  abandoned_village: { label: 'pueblo abandonado', genre: 'fantasy', required: ['abandoned_street', 'abandoned_house'], optional: ['temple', 'cemetery', 'inn', 'smithy', 'square'], places: [4, 5],
    roles_required: ['scavenger'], roles_optional: ['hermit', 'survivor', 'hunter', 'stranger'], npcs: [3, 4],
    wild: ['forest', 'swamp', 'ruin', 'hills'], weight: { horror: 4, grim: 2 }, beasts: ['wolf', 'boar'] },
  cave_settlement: { label: 'asentamiento en cuevas', genre: 'fantasy', required: ['cave_hall', 'cave_shrine'], optional: ['mine_gallery', 'healer', 'warehouse', 'smithy'], places: [4, 5],
    roles_required: ['elder', 'sorceress'], roles_optional: ['hunter', 'smith', 'healer', 'miner'], npcs: [4, 5],
    wild: ['mountain_pass', 'forest', 'river', 'ruin'], weight: { horror: 2, epic: 1 }, beasts: ['wolf'] },
  // Ciencia ficción
  space_port: { label: 'puerto espacial', genre: 'scifi', required: ['spaceport', 'cantina', 'hangar'], optional: ['market_deck', 'security_office', 'med_bay', 'habitat_ring'], places: [4, 6],
    roles_required: ['port_master', 'bartender'], roles_optional: ['mechanic', 'smuggler', 'security_agent', 'medic', 'stranger', 'merchant'], npcs: [4, 6],
    wild: ['wasteland', 'derelict'] },
  mining_station: { label: 'estación minera', genre: 'scifi', required: ['habitat_ring', 'mine_shaft', 'security_office'], optional: ['cantina', 'med_bay', 'hangar', 'market_deck'], places: [4, 6],
    roles_required: ['foreman', 'security_agent'], roles_optional: ['miner', 'medic', 'bartender', 'mechanic', 'smuggler'], npcs: [4, 6],
    wild: ['wasteland', 'derelict'] },
  // Postapocalíptico
  shelter_settlement: { label: 'refugio de supervivientes', genre: 'postapoc', required: ['shelter', 'scrap_market'], optional: ['water_tower', 'garage', 'barricade', 'clinic'], places: [4, 6],
    roles_required: ['shelter_boss', 'scavenger'], roles_optional: ['mechanic', 'sentinel', 'medic', 'water_keeper', 'merchant', 'stranger'], npcs: [4, 6],
    wild: ['highway', 'dead_city', 'forest'], beasts: ['wolf'] },
  scrap_town: { label: 'pueblo de chatarra', genre: 'postapoc', required: ['scrap_market', 'barricade', 'garage'], optional: ['shelter', 'water_tower', 'clinic'], places: [4, 6],
    roles_required: ['merchant', 'sentinel'], roles_optional: ['mechanic', 'scavenger', 'medic', 'water_keeper', 'thief', 'stranger'], npcs: [4, 6],
    wild: ['highway', 'dead_city'], beasts: ['wolf', 'boar'] },
} satisfies Record<string, SettlementDef>;

export type SettlementType = keyof typeof SETTLEMENTS;

/** Lugares que dan salida al exterior, por preferencia. */
export const EXIT_PLACES: PlaceKind[] = ['gate', 'barricade', 'dock', 'spaceport', 'mine_mouth', 'monastery_gate', 'abandoned_street', 'wagon_circle', 'habitat_ring', 'cave_hall', 'courtyard', 'square', 'market'];

/** Género por palabras de la ambientación. */
export function genreOf(setting: string): Genre {
  const t = setting.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/(ciencia ficcion|sci-?fi|espacial|espacio|nave|planeta|galaxia|estacion|androide|robot|ciberpunk|cyberpunk|futur)/.test(t)) return 'scifi';
  if (/(postapocal|post-apocal|apocalipsis|yermo|radiacion|nuclear|zombi|colapso|fin del mundo)/.test(t)) return 'postapoc';
  return 'fantasy';
}
