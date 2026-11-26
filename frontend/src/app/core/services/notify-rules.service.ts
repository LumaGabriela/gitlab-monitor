import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { PanelEventKind, PanelEventModel, RowFactsModel } from '../models/api/panel-api.model';
import {
  RULE_FIELD_KINDS,
  RULE_MODES,
  RULE_OPERATORS,
  RuleField,
  RuleMode,
  RuleOperator,
  matches,
} from '../rules/rule-engine';
import { PreferencesStore } from './preferences-store.service';
import { uniqueId } from './unique-id';

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

/** Um critério de aviso: a mesma comparação de campo, operador e valor das
 * regras de destaque, mas que avisa ou silencia, e só para os tipos indicados. */
export interface NotifyRule {
  readonly id: string;
  readonly field: RuleField;
  readonly operator: RuleOperator;
  readonly value: string;
  readonly mode: RuleMode;
  /** Vazia = todos os tipos. */
  readonly kinds: readonly PanelEventKind[];
  readonly enabled: boolean;
}

/** Quem decide o que vira aviso: o corte geral ou os critérios. Um só vale. */
export type NotifyDecider = 'general' | 'rules';

export const NOTIFY_DECIDERS: readonly NotifyDecider[] = ['general', 'rules'];

export interface NotifyRules {
  /** `general`: valem os campos do corte geral e os critérios ficam de lado.
   * `rules`: só passam os eventos que casam com algum critério. O horário de
   * silêncio e a espera por MR valem nos dois: são limites de incômodo, e não
   * critérios de interesse. */
  readonly decider: NotifyDecider;
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
  readonly rules: readonly NotifyRule[];
}

const MINUTE_MS = 60_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_RULES: NotifyRules = {
  decider: 'general',
  kinds: { opened: true, likes: true, pipeline: true, threads: true, left: true, review: true },
  onlyMine: false,
  minLikes: 0,
  ignoreDrafts: false,
  mutedAuthors: [],
  quietHours: null,
  cooldownMinutes: 0,
  rules: [],
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

  /** Uma regra nova nasce desligada: `notify` sem valor não casa com nada e,
   * ligada, poria todos os tipos em lista de inclusão e calaria tudo. */
  public addRule(): void {
    const rule: NotifyRule = {
      id: uniqueId(),
      field: 'likes',
      operator: 'gte',
      value: '',
      mode: 'notify',
      kinds: [],
      enabled: false,
    };
    this.update({ rules: [...this.stored().rules, rule] });
  }

  public updateRule(id: string, patch: Partial<Omit<NotifyRule, 'id'>>): void {
    this.update({
      rules: this.stored().rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    });
  }

  public removeRule(id: string): void {
    this.update({ rules: this.stored().rules.filter((rule) => rule.id !== id) });
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
    // Silêncio e espera valem sempre; o resto é do lado escolhido.
    return events.filter(
      (event): boolean =>
        !this.coolingDown(event.url, cooldownMs, now) &&
        (rules.decider === 'rules'
          ? passesCriteria(rules.rules, event)
          : rules.kinds[event.kind] !== false &&
            (!rules.onlyMine || event.involved) &&
            event.likes >= rules.minLikes &&
            (!rules.ignoreDrafts || !event.draft) &&
            !muted.includes(event.author.toLowerCase())),
    );
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

/** A regra está ligada e vale para o tipo (`kinds` vazia = todos). Só olha o
 * tipo, nunca os fatos: é o que põe o tipo em regime de lista de inclusão. */
function coversKind(rule: NotifyRule, kind: PanelEventKind): boolean {
  return rule.enabled && (rule.kinds.length === 0 || rule.kinds.includes(kind));
}

/** O evento traz fatos: ausente, `null` e o que não é objeto valem como sem fatos
 * (o JSON do backend não é validado em runtime), igual a `has_facts` do Python. */
function hasFacts(event: PanelEventModel): event is PanelEventModel & { facts: RowFactsModel } {
  const facts: unknown = event.facts;
  return typeof facts === 'object' && facts !== null && !Array.isArray(facts);
}

/** Cobre o tipo do evento e casa com os fatos dele; evento sem `facts` não casa. */
function applies(rule: NotifyRule, event: PanelEventModel): boolean {
  return coversKind(rule, event.kind) && hasFacts(event) && matches(rule, event.facts);
}

/** Fase das regras de critério, depois do corte geral. Evento sem `facts` passa
 * intocado: o MR que saiu da lista não tem linha, e calá-lo por falta de fato
 * seria calá-lo para sempre. Regra `mute` aplicável descarta; havendo regra
 * `notify` ligada para o tipo, só passa quem casa com alguma. */
function passesCriteria(criteria: readonly NotifyRule[], event: PanelEventModel): boolean {
  if (!hasFacts(event)) return true;
  if (criteria.some((rule) => rule.mode === 'mute' && applies(rule, event))) return false;
  const notify = criteria.filter((rule) => rule.mode === 'notify');
  if (!notify.some((rule) => coversKind(rule, event.kind))) return true;
  return notify.some((rule) => applies(rule, event));
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
    decider: raw['decider'] === 'rules' ? 'rules' : 'general',
    kinds,
    onlyMine: raw['onlyMine'] === true,
    minLikes: nonNegativeInt(raw['minLikes']),
    ignoreDrafts: raw['ignoreDrafts'] === true,
    mutedAuthors: Array.isArray(raw['mutedAuthors'])
      ? raw['mutedAuthors'].filter((item): item is string => typeof item === 'string')
      : [],
    quietHours,
    cooldownMinutes: nonNegativeInt(raw['cooldownMinutes']),
    rules: parseCriteria(raw['rules']),
  };
}

function isNotifyRule(item: unknown): item is Record<string, unknown> {
  if (typeof item !== 'object' || item === null) return false;
  const rule = item as Record<string, unknown>;
  return (
    typeof rule['id'] === 'string' &&
    typeof rule['field'] === 'string' &&
    Object.hasOwn(RULE_FIELD_KINDS, rule['field']) &&
    typeof rule['operator'] === 'string' &&
    (RULE_OPERATORS as readonly string[]).includes(rule['operator']) &&
    typeof rule['value'] === 'string' &&
    typeof rule['mode'] === 'string' &&
    (RULE_MODES as readonly string[]).includes(rule['mode']) &&
    typeof rule['enabled'] === 'boolean'
  );
}

/** Descarta o item ilegível, mantendo os vizinhos. `kinds` ausente, vazia ou só
 * de tipos desconhecidos vale como todos os tipos (lista vazia). */
function parseCriteria(value: unknown): readonly NotifyRule[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isNotifyRule).map((rule): NotifyRule => ({
    id: rule['id'] as string,
    field: rule['field'] as RuleField,
    operator: rule['operator'] as RuleOperator,
    value: rule['value'] as string,
    mode: rule['mode'] as RuleMode,
    kinds: Array.isArray(rule['kinds'])
      ? rule['kinds'].filter((kind): kind is PanelEventKind =>
          (NOTIFY_EVENT_KINDS as readonly unknown[]).includes(kind),
        )
      : [],
    enabled: rule['enabled'] as boolean,
  }));
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}
