---
title: "Mapa de misiones"
aliases: ["Diagrama de misiones", "Flujo de misiones"]
description: "Qué misión abre cuál en Brezal, quién la pide y dónde, el nivel que hace falta y cuáles van por fases, con cuántas vías y desenlaces. Sale de los datos de la historia."
tags: [mision, brezal, mapa]
---
El mapa de todas las misiones de Brezal. Cada caja es una misión: su acto (por el color), su nivel (y, entre paréntesis, el mínimo para que te la pidan), quién la pide y dónde está al empezar la partida y, si va por fases, cuántas fases, vías y desenlaces tiene. Las flechas van de la misión que hay que cumplir a la que abre; una flecha discontinua es una de varias que valen.

Las columnas dicen cuántas misiones, como mínimo, hay que cumplir antes. A la izquierda, las principales: cada personaje tiene la de su [[Situaciones iniciales|situación inicial]] desde el principio. Cómo funciona cada una, en [[Misiones]] y en los actos: [[Acto I · Lo que trae el agua]], [[Acto II · Lo que esconde Brezal]] y [[Acto III · La noche de la Brasa]].

![[Mapa de misiones.svg]]
*Generado de los datos de la historia: no se dibuja a mano. Si cambia una misión, `npm run wiki:misiones` lo vuelve a sacar.*

> [!info] Misiones por fases
> Tres misiones van ya por fases, con varias formas de resolver cada objetivo y desenlaces distintos según cómo quede el mundo: [[Acto I · Lo que trae el agua#Ceniza se ha perdido|Ceniza se ha perdido]], [[Acto II · Lo que esconde Brezal#La cadena de hierro frío|La cadena de hierro frío]] y [[Acto II · Lo que esconde Brezal#El hijo del molinero|El hijo del molinero]]. Ver [[Misiones#Misiones por fases|Misiones por fases]].

## Todas las misiones

*Sale de los datos de la historia: no se edita a mano (`npm run wiki:misiones`).*

| Misión | Acto | Nivel | Quién la pide y dónde | Se abre con | Abre | Forma |
|---|---|---|---|---|---|---|
| La carta de Vharn | Principal | 1 | Desde el principio | Nada | Nada | Pasos |
| Lo que dejó tu padre | Principal | 1 | Desde el principio | Nada | Nada | Pasos |
| Lo prometido | Principal | 1 | Desde el principio | Nada | Nada | Pasos |
| Salir de la aldea | Principal | 1 | Desde el principio | Nada | Nada | Pasos |
| El agua turbia | I | 1 | Ilse, en las hierbas colgadas (Casa de las hierbas) | Nada | «La cadena de hierro frío» | Pasos |
| La cena del portón | I | 1 | Brenna, en la barra (Taberna del Jabalí) | Nada | «Lo que vio Doro» | Pasos |
| Ceniza se ha perdido | I | 2 (desde 1) | Brenna, en la barra (Taberna del Jabalí) | Nada | «Bajo el Jabalí», «El Granero Quemado» | 2 fases y 1 secundaria, 13 vías, 5 desenlaces |
| Un jarabe para el molino | I | 1 | Ilse, en las hierbas colgadas (Casa de las hierbas) | Nada | Nada | Pasos |
| La reja del molino | I | 1 | Mateo, en las muelas (El molino) | conocer a Mateo | Nada | Pasos |
| La ronda de los Corrales | I | 1 | Doro, en el portón norte (Plaza del Pozo) | conocer a Doro | Nada | Pasos |
| Lo que no cuesta no sana | I | 1 | Úrsula, en el gallinero (Los Corrales) | conocer a Úrsula | Nada | Pasos |
| Una jarra para el cazador | I | 1 | Hal, en la piedra grande (El Soto) | Nada | Nada | Pasos |
| Lo que vio Doro | I | 2 (desde 1) | Doro, en el portón norte (Plaza del Pozo) | «La cena del portón» | «El hijo del molinero», «El Granero Quemado» | Pasos |
| Bajo el Jabalí | II | 3 (desde 2) | Brenna, en la barra (Taberna del Jabalí) | «Ceniza se ha perdido» | «La verdad en el pozo» | Pasos |
| La cadena de hierro frío | II | 3 (desde 2) | Ilse, en las hierbas colgadas (Casa de las hierbas) | «El agua turbia» | «Templar el ascua» | 2 fases, 3 vías, 4 desenlaces |
| El hijo del molinero | II | 3 (desde 2) | Mateo, en las muelas (El molino) | «Lo que vio Doro» o la pista «Las cartas del desván» | Nada | 2 fases y 1 secundaria, 8 vías, 4 desenlaces |
| El Granero Quemado | II | 3 (desde 2) | Hal, en la piedra grande (El Soto) | «Lo que vio Doro» o «Ceniza se ha perdido» | «Templar el ascua» | Pasos |
| Que arda Vharn | III | 4 (desde 3) | Ysolde, en el pajar hundido (El Granero Quemado) | la pista «La heredera de Vharn» | Nada | final excluyente |
| La verdad en el pozo | III | 4 (desde 3) | Brenna, en la barra (Taberna del Jabalí) | «Bajo el Jabalí» y la pista «La heredera de Vharn» | Nada | final excluyente |
| Templar el ascua | III | 4 (desde 3) | Ilse, en las hierbas colgadas (Casa de las hierbas) | «La cadena de hierro frío» y «El Granero Quemado» | Nada | final excluyente |
