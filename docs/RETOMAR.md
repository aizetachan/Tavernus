# Dónde lo dejamos y qué sigue

Actualizado: 31 de octubre de 2026.

## Estado

El producto es la **web propia** (`src/adapters/web`), en producción en tavernus.com, en un VPS propio
([`DESPLIEGUE.md`](DESPLIEGUE.md)). La última versión desplegada es `20261031-093930`: despliegue con
el usuario `tavernus`, sin root (PR #67), y misiones con charla previa y mochila (PR #68).

Para arrancarla, [`README.md`](../README.md). Sin gastar API:

```
npm run web:offline
```

## Qué sigue

1. **Jugar en tavernus.com** para comprobar la mochila y las misiones en una partida real: desde ese
   despliegue no hay ninguna acción en producción.
2. **Revisar los PR abiertos**: [#69](https://github.com/aizetachan/Tavernus/pull/69) (test de
   ilustraciones con azar fijo) y [#70](https://github.com/aizetachan/Tavernus/pull/70) (diario de
   misiones en pestañas).
3. **Traer a la web lo que solo existía en Discord:**
   - Creación completa de personaje (issue #14). Los pasos, sin cliente, están en `src/engine/creation.ts`.
   - Reportar un problema y estado para el admin (issue #18).
   - Avisos de lo que pasa mientras no estás y tablón (issue #19).
   - Bienvenida: sin issue todavía. Los textos del bot siguen en el historial
     (`git show 77662ab:src/adapters/discord/texts.ts`).
4. **Revisar con el equipo** el borrador de issues, milestones y fechas (issue #4): M0 Base (31 oct),
   M1 Diseño: kit y UX (21 nov), M2 Beta cerrada (19 dic) y M3 Mundos generados (26 feb 2027). Están en
   el [Project «Tavernus · hacia la beta»](https://github.com/users/aizetachan/projects/11).
5. **Diseño:** kit pequeño y vuelta fuerte de UX (issues #8 a #13). La referencia es el
   [archivo TAVERNUS de Figma](https://www.figma.com/design/DLtN2zFOjXqXO4qDTudun3/TAVERNUS), propuesta 4
   versión B, «vidrio espacial».

El plan por fases hacia mundos generados y vivos está en [`PLAN.md`](PLAN.md).

## Historia

El juego nació como bot de Discord, con la spec de [`SPEC.md`](SPEC.md). Corrió en el Mac de Santy y se
preparó una VM gratuita de Google para moverlo allí. El 21 de octubre de 2026 el producto pasó a ser la
web, y el 25 se desplegó en el VPS. El bot, sus scripts y los de la VM se retiraron el 31 de octubre
(issue #5); el último commit que los contiene es `77662ab`. Lo observado en las pruebas con jugadores
de entonces sigue en [`NOTAS-GUIA-USUARIO.md`](NOTAS-GUIA-USUARIO.md).
