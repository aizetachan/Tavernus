/**
 * Chuleta de reglas SRD 5e que más se usan en mesa. Va en el bloque de sistema
 * (cacheado), así el máster no gasta una llamada en lookup_rule para lo habitual.
 * Adaptada al motor: no hay turnos ni casillas; distancias en metros (1,5 m = 5 pies).
 * El servidor ya resuelve tiradas, CA, daño y críticos; esto es para lo que decide el máster.
 */
export const RULES_CHEATSHEET = [
  'REGLAS DE REFERENCIA (SRD 5e; para lo demás, lookup_rule):',
  '- Ventaja/desventaja no se acumulan; si hay de las dos, se anulan. Ventaja: atacar sin ser visto; objetivo derribado a 1,5 m, apresado, aturdido, paralizado o inconsciente; ayuda de otro. Desventaja: disparar con un enemigo a 1,5 m o más allá del alcance normal; atacante envenenado, asustado, derribado o apresado; objetivo invisible o a oscuras.',
  '- Cobertura media o de tres cuartos: el servidor no suma CA, aplícala como desventaja. Total: no se puede apuntar.',
  '- Pasiva = 10 + mod. Prueba en grupo: éxito si lo logra la mitad. Con tiempo y nada que perder, no tires: lo consigue.',
  '- Agarrar: objetivo de hasta un tamaño más, mano libre; athletics contra athletics o acrobatics. Zafarse: lo mismo a la inversa. Empujar: misma tirada; derriba o aparta 1,5 m.',
  '- Ocultarse: sin ser visto; stealth contra la percepción pasiva. Atacar o hacer ruido delata.',
  '- Penumbra: desventaja en percepción visual. Oscuridad: como cegado. Visión en la oscuridad (enano, elfo, gnomo, semielfo, semiorco, tiefling): 18 m, oscuridad como penumbra.',
  '- Caída: 1d6 por cada 3 m (máx. 20d6), cae derribado. Salto con carrerilla: largo FUE × 0,3 m, alto (3 + mod. FUE) × 0,3 m; parado, la mitad.',
  '- Asfixia: aguanta 1 + mod. CON minutos (mín. 30 s); luego mod. CON asaltos (mín. 1) y cae a 0 PG.',
  '- Descanso corto (1 h): gasta Dados de Golpe (tantos como su nivel); cada uno cura su dado + mod. CON, con roll_dice y heal. Dado: d12 bárbaro; d10 guerrero, paladín, explorador; d6 hechicero, mago; d8 el resto. Descanso largo (8 h, uno al día): todos los PG, la mitad de los Dados de Golpe y un nivel de agotamiento menos.',
  '- 0 PG: inconsciente. Salvación contra muerte d20, CD 10: 3 éxitos estable, 3 fallos muere; 1 natural, dos fallos; 20 natural, 1 PG. Daño a 0 PG, un fallo. Si el daño sobrante llega a sus PG máximos, muere. Estabilizar: medicine CD 10.',
  '- CA de objetos: madera 15, piedra 17, hierro 19, cristal 13, cuerda 11.',
  '- Condiciones (nombre para add_condition):',
  '  agarrado: velocidad 0.',
  '  apresado: velocidad 0; ataca con desventaja, le atacan con ventaja; desventaja en salvaciones de DES.',
  '  asustado: desventaja en pruebas y ataques si ve la fuente; no se le acerca.',
  '  aturdido / paralizado: no actúa ni se mueve; falla salvaciones de FUE y DES; le atacan con ventaja (paralizado: crítico a 1,5 m).',
  '  cegado: ataca con desventaja, le atacan con ventaja.',
  '  derribado: se arrastra; ataca con desventaja; le atacan con ventaja a 1,5 m y desventaja a distancia.',
  '  encantado: no daña a quien lo encanta, que tiene ventaja social con él.',
  '  envenenado: desventaja en ataques y pruebas.',
  '  inconsciente: suelta todo y cae; falla salvaciones de FUE y DES; le atacan con ventaja y crítico a 1,5 m.',
  '  invisible: ataca con ventaja, le atacan con desventaja.',
  '  agotamiento (acumulativo): 1 desventaja en pruebas; 2 media velocidad; 3 desventaja en ataques y salvaciones; 4 PG máx. a la mitad; 5 velocidad 0; 6 muerte.',
].join('\n');
