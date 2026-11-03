---
title: "Situaciones iniciales"
description: "Cómo empieza cada personaje en Brezal sellada según su clase; tres situaciones con reloj de 3 días y dos para compañeros."
tags: [mision, brezal, situacion]
---
Nadie llega a Brezal sin más. Cada personaje empieza con **un problema personal desde el primer segundo**. La situación depende de su clase.

Reglas comunes:
- Todas empiezan a las **18:00 del primer día**. La misa del pozo es dos horas después.
- Todas **vencen a los 3 días**, la noche de la Brasa.
- El personaje llegó al valle antes de que bajara la niebla, hace tres semanas, y ya no puede irse.
- No se gastan: dos magos reciben la misma.
- Cada uno empieza conociendo ya a quien debe conocer.
- Quien sale en la apertura existe y está allí: Ilse en el pozo, Hugo en el banco de la herrería, Garrán en tu mesa del Jabalí. Un test comprueba que cada persona nombrada en una apertura es un NPC que la apertura pone con el personaje.

| Situación | Para | Empieza en | Antagonista |
|---|---|---|---|
| [[#La carta lacrada]] | mago, hechicero, brujo, clérigo, druida, bardo | el pozo de la [[Plaza del Pozo]] | [[Osric Malvez]] |
| [[#El hijo del herrero]] | guerrero, bárbaro, paladín, explorador, monje | el banco de [[La herrería]] | [[Osric Malvez]] |
| [[#El deudor]] | cualquier otra clase (pícaro…) | la mesa del fondo de la [[Taberna del Jabalí]] | [[Garrán]] |

## La carta lacrada

- **Por qué está aquí**: hace un mes le llegó una carta sin remite, lacrada con el sello de Vharn: «La Brasa despierta. Ven antes de que se cierre el valle». Llegó la víspera de la niebla.
- **Quiere**: saber quién le escribió, qué es la Brasa y qué cerrojo ha cerrado el valle.
- **Le amenaza**: Osric dice que la niebla es la maldición de Vharn y vigila a quien pregunta por el granero.
- **Si se acaba el reloj**: el ascua se suelta en la plaza y lo que ardió hace veinte años vuelve a arder, con el valle cerrado.
- **Lleva**: la carta lacrada. Conoce a [[Ilse]].
- **Primer instante**: junto al pozo, [[Ilse]], que ha venido temprano a poner las velas de la misa, ve asomar el lacre, se le cae una vela al agua y le agarra la muñeca: «¿Quién te ha mandado eso?». El motor la lleva al pozo antes de la primera escena y la deja allí media hora de juego (`with_npc_ids`).
- **Caminos**: buscar a Ilse; enseñar la carta en la taberna y mirar quién palidece; ir al [[El Lindero|Lindero]] a mirar la niebla.

## El hijo del herrero

- **Por qué está aquí**: su padre fue el herrero de Vharn y murió en el incendio. Hugo, su aprendiz, le mandó llamar: dice que su padre dejó algo y que «no fue el fuego lo que lo mató». Llegó con el último carro.
- **Quiere**: saber cómo murió su padre y quién tiene la culpa.
- **Le amenaza**: Osric, mayordomo de Vharn aquella noche, tiene a Hugo agarrado por una deuda y quiere que funda lo que guarda.
- **Si se acaba el reloj**: Garrán cierra la herrería y lo que dejó su padre acaba en el crisol o bajo la ceniza.
- **Conoce a**: [[Hugo]] y [[Garrán]].
- **Primer instante**: Hugo cierra la puerta de la fragua y baja la voz: «Aquí no. El alguacil ha pasado dos veces hoy». Fuera, unas botas se paran y no se van.
- **Caminos**: apretar a Hugo hasta que enseñe lo que guarda; pagar su deuda con el regidor; preguntar en el Jabalí quién estuvo en Vharn aquella noche.

## El deudor

- **Por qué está aquí**: llegó la víspera de la niebla con fiebre y una herida de camino. [[Brenna]] le dio cama a crédito y la curandera le cosió.
- **Quiere**: salir de la aldea: averiguar qué es la niebla y cómo cruzarla, sin que el regidor le cobre antes la deuda a su manera.
- **Misión principal**: **«Salir de la aldea»**. Primer paso: averiguar qué es la niebla y cómo salir (se cumple con la pista de la Brasa, de [[Ilse]]). Después, decidir qué pasa con el ascua; por último, cruzar la niebla hacia Valcruz, que en la demo no se puede: la misión queda abierta. Las pistas no se le dicen: las encuentra por su cuenta.
- **Le amenaza**: el regidor ([[Osric Malvez]]) le compró la deuda a [[Brenna]] y [[Garrán]], su alguacil, la cobra en su nombre. **300 monedas en 3 días**, o trabajar para el regidor: ir al [[El Granero Quemado|Granero Quemado]] a «apagar las luces».
- **Si se acaba el reloj**: Garrán le quita lo que lleva de valor y le manda al granero con una lanza en la espalda.
- **Empieza con**: la deuda anotada (se le debe al regidor; se le paga a Garrán), que vence con el reloj. En el Diario es su propia entrada, «Deuda con el regidor», con su plazo. Conoce a Brenna y a Garrán.
- **Primer instante**: Garrán deja en la mesa una tablilla con su nombre y la cifra 300. «Lo tuyo ahora es del regidor, y lo cobro yo. Tres días», dice, y se bebe su cerveza. «Y no pienses en la niebla: los deudores no pueden huir. Mejor».
- **Caminos**: pagar con trabajo honrado (ver [[Encargos del tablón]]); aceptar el encargo del regidor e ir al granero; averiguar por qué el regidor quiere gente allí y usarlo contra él.

## Situaciones de compañero

En multijugador, quien entra con «Empezar junto a…» recibe la versión de compañero de la situación del otro.

- **Compañero del hijo del herrero**: llegó en el mismo carro; le pagaron el viaje desde Valcruz a cambio de cubrir la espalda. Quiere cobrar lo prometido. Empieza en la herrería, vigilando la puerta. Hugo apenas le mira: «Tú, a la puerta».
- **Compañero de la carta lacrada**: viaja con quien recibió la carta desde hace un mes y no le dejó venir solo. Empieza junto al pozo. Ilse agarra la muñeca de su compañero y después le mira a él de arriba abajo.

Las dos vencen igual que la original, a los 3 días, con [[Osric Malvez]] como antagonista.

## Sin situación

Quien llega sin situación (personajes anteriores a la historia) empieza en uno de tres sitios:
- la puerta de la [[Taberna del Jabalí]]: un viajero sin blanca que llegó la víspera de la niebla;
- el pozo de la [[Plaza del Pozo]]: alguien que se crió aquí y volvió hace un mes;
- el sendero de [[El Soto]]: alguien que ha pasado la noche en la arboleda.
