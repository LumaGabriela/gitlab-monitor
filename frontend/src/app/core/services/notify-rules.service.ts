import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { PanelEventKind, PanelEventModel } from '../models/api/panel-api.model';
import { PreferencesStore } from './preferences-store.service';

export const NOTIFY_EVENT_KINDS: readonly PanelEventKind[] = [
  'opened',
  'likes',
  'pipeline',
  'threads',
  'left',
  'review',
];

export interface QuietHours {
  /** "HH:MM", hora local. */
  readonly start: string;
  readonly end: string;
}

export interface NotifyRules {
  readonly kinds: Readonly<Record<PanelEventKind, boolean>>;
  /** Só MR meu ou em que participo. */
  readonly onlyMine: boolean;
  /** 0 = não filtra. */
  readonly minLikes: number;
  readonly ignoreDrafts: boolean;
  readonly mutedAuthors: readonly string[];
  readonly quietHours: QuietHours | null;
  /** 0 = sem espera. */
  readonly cooldownMinutes: number;
}

const MINUTE_MS = 60_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_RULES: NotifyRules = {
  kinds: { opened: true, likes: true, pipeline: true, threads: true, left: true, review: true },
  onlyMine: false,
  minLikes: 0,
  ignoreDrafts: false,
  mutedAuthors: [],
  quietHours: null,
  cooldownMinutes: 0,
};

/**
 * Quais mudanças merecem aviso no navegador, escolhido por quem olha e
 * lembrado entre sessões. O que as regras (ou o silêncio, ou a espera)
 * barram é descartado: não fica numa fila para avisar depois.
 */
@Injectable({ providedIn: 'root' })
export class NotifyRulesService {
  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly stored: WritableSignal<NotifyRules> = signal<NotifyRules>(
    parseRules(this.store.read('notifyRules')),
  );

  public readonly rules: Signal<NotifyRules> = this.stored.asReadonly();

  /** Quando cada MR avisou pela última vez, pela URL; só em memória, vale por
   * sessão. A chave é a URL e não o `mr`: `mr` é o número dentro do alvo
   * (`iid`, ou `project_id:iid` em grupo) e dois alvos em modo projeto repetem
   * o mesmo `!7` — um aviso calaria o outro. A URL é única entre alvos, e é
   * ela que a dedup da união já usa no backend. */
  private readonly lastNotified = new Map<string, number>();

  public update(patch: Partial<NotifyRules>): void {
    const next: NotifyRules = { ...this.stored(), ...patch };
    this.stored.set(next);
    this.store.write('notifyRules', next);
  }

  /** Os eventos que passam pelas regras, já descontado o silêncio e a espera. Não escreve nada. */
  public filter(
    events: readonly PanelEventModel[],
    now: Date = new Date(),
  ): readonly PanelEventModel[] {
    const rules = this.stored();
    if (rules.quietHours && isQuiet(rules.quietHours, now)) return [];

    const muted = rules.mutedAuthors.map((author) => author.toLowerCase());
    const cooldownMs = rules.cooldownMinutes * MINUTE_MS;
    const passed = events.filter(
      (event): boolean =>
        rules.kinds[event.kind] !== false &&
        (!rules.onlyMine || event.involved) &&
        event.likes >= rules.minLikes &&
        (!rules.ignoreDrafts || !event.draft) &&
        !muted.includes(event.author.toLowerCase()) &&
        !this.coolingDown(event.url, cooldownMs, now),
    );

    return passed;
  }

  /** Registra o aviso entregue, o que inicia a espera de cada MR. Separado de
   * `filter` para que um lote que não chegou a ser entregue (permissão ainda
   * pendente, por exemplo) não seja cortado pela espera quando voltar. */
  public markNotified(events: readonly PanelEventModel[], now: Date = new Date()): void {
    for (const event of events) this.lastNotified.set(event.url, now.getTime());
  }

  private coolingDown(url: string, cooldownMs: number, now: Date): boolean {
    const last = this.lastNotified.get(url);
    return cooldownMs > 0 && last !== undefined && now.getTime() - last < cooldownMs;
  }
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Compara HH:MM locais. Com `start > end` a janela atravessa a meia-noite e
 * é a união dos dois trechos (da hora inicial até 24h, e de 0h até a final). */
function isQuiet({ start, end }: QuietHours, now: Date): boolean {
  const from = minutesOf(start);
  const to = minutesOf(end);
  const current = now.getHours() * 60 + now.getMinutes();
  // Início igual ao fim é janela vazia, não 24 horas.
  if (from === to) return false;
  return from < to ? current >= from && current < to : current >= from || current < to;
}

/** Cada campo é lido sozinho: o que o código atual não entende volta ao
 * padrão, sem derrubar os que estão certos nem calar o painel por engano. */
export function parseRules(parsed: unknown): NotifyRules {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_RULES;
  const raw = parsed as Record<string, unknown>;
  const rawKinds =
    typeof raw['kinds'] === 'object' && raw['kinds'] !== null
      ? (raw['kinds'] as Record<string, unknown>)
      : {};
  const kinds = { ...DEFAULT_RULES.kinds };
  for (const kind of NOTIFY_EVENT_KINDS) {
    if (typeof rawKinds[kind] === 'boolean') kinds[kind] = rawKinds[kind];
  }
  const quiet = raw['quietHours'] as Record<string, unknown> | null | undefined;
  const quietHours =
    quiet &&
    typeof quiet['start'] === 'string' &&
    typeof quiet['end'] === 'string' &&
    TIME_PATTERN.test(quiet['start']) &&
    TIME_PATTERN.test(quiet['end'])
      ? { start: quiet['start'], end: quiet['end'] }
      : null;
  return {
    kinds,
    onlyMine: raw['onlyMine'] === true,
    minLikes: nonNegativeInt(raw['minLikes']),
    ignoreDrafts: raw['ignoreDrafts'] === true,
    mutedAuthors: Array.isArray(raw['mutedAuthors'])
      ? raw['mutedAuthors'].filter((item): item is string => typeof item === 'string')
      : [],
    quietHours,
    cooldownMinutes: nonNegativeInt(raw['cooldownMinutes']),
  };
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}
