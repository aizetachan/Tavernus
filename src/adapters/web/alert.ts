/**
 * Avisos al anfitrión desde la web: el mismo ALERT_WEBHOOK que usa la comprobación de salud
 * (deploy/healthcheck.sh, docs/DESPLIEGUE.md), con Telegram, Discord, ntfy o un POST JSON genérico.
 *
 * Hoy solo avisa de una cosa: la cuenta de la IA se ha quedado sin crédito (master.ts, noCredit). Esperar no lo
 * arregla, así que el anfitrión tiene que enterarse. Un aviso al quedarse sin saldo y otro al volver, no uno por acción.
 */
import type { MasterCall } from '../../engine/engine.js';

export type AlertSender = (text: string) => Promise<void>;

/** Manda `text` al webhook de ALERT_WEBHOOK; sin webhook, solo queda en el registro. Nunca lanza. */
export function webhookAlert(env: NodeJS.ProcessEnv, log: (line: string) => void, fetchFn: typeof fetch = (...a) => fetch(...a)): AlertSender {
  return async (text) => {
    log(`[aviso] ${text}`);
    const hook = env['ALERT_WEBHOOK']?.trim();
    if (!hook) return;
    const body = `[Tavernus] ${text}`;
    try {
      let res: Response;
      if (/api\.telegram\.org\//.test(hook)) {
        res = await fetchFn(hook, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ text: body }).toString(), signal: AbortSignal.timeout(15_000) });
      } else if (/discord(app)?\.com\/api\/webhooks\//.test(hook)) {
        res = await fetchFn(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: body }), signal: AbortSignal.timeout(15_000) });
      } else if (/ntfy\.sh\/|\/ntfy\//.test(hook)) {
        res = await fetchFn(hook, { method: 'POST', headers: { Title: 'Tavernus' }, body, signal: AbortSignal.timeout(15_000) });
      } else {
        res = await fetchFn(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: body, content: body }), signal: AbortSignal.timeout(15_000) });
      }
      if (!res.ok) log(`[aviso] el webhook respondió ${res.status}`);
    } catch (e) {
      log(`[aviso] no se pudo mandar al webhook: ${(e as Error).message}`);
    }
  };
}

/** Vigila las llamadas al máster de todas las partidas: avisa al quedarse sin crédito y al volver a responder. */
export class CreditAlarm {
  private down: string | null = null;

  constructor(private readonly send: AlertSender) {}

  master(game: string, c: MasterCall): void {
    if (!c.ok && c.error?.reason === 'no_credit') {
      if (this.down) return;
      this.down = game;
      void this.send(`El máster se ha quedado sin crédito en la API de Anthropic (partida «${game}»). Nadie puede jugar hasta que recargues: console.anthropic.com → Plans & Billing.`);
    } else if (c.ok && this.down) {
      this.down = null;
      void this.send(`El máster vuelve a responder (partida «${game}»): ya hay crédito.`);
    }
  }
}
