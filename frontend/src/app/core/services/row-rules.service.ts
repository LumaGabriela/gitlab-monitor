import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { RowFactsModel } from '../models/api/panel-api.model';
import {
  HighlightRule,
  RULE_FIELD_KINDS,
  RULE_OPERATORS,
  RULE_TONES,
  RuleTone,
  firstMatch,
  firstTone,
  markStyleOf,
} from '../rules/rule-engine';

import { PreferencesStore } from './preferences-store.service';
import { uniqueId } from './unique-id';

export type NewHighlightRule = Omit<HighlightRule, 'id'>;

/** Uma regra pronta, oferecida como botão em Configurações. `key` escolhe o
 * texto no catálogo (`settings.suggestion-<key>`). */
export interface RuleSuggestion {
  readonly key: string;
  readonly rule: NewHighlightRule;
}

// Cada regra compara um fato só: as sugestões escolhem a condição que mais
// se aproxima do que o nome promete.
export const ROW_RULE_SUGGESTIONS: readonly RuleSuggestion[] = [
  {
    key: 'pipeline-failed',
    rule: {
      field: 'pipeline',
      operator: 'eq',
      value: 'failed',
      tone: 'danger',
      markStyle: 'solid',
      enabled: true,
    },
  },
  {
    key: 'conflicts',
    rule: {
      field: 'conflicts',
      operator: 'eq',
      value: 'true',
      tone: 'danger',
      markStyle: 'solid',
      enabled: true,
    },
  },
  {
    key: 'ready-to-merge',
    rule: {
      field: 'mergeable',
      operator: 'eq',
      value: 'true',
      tone: 'success',
      markStyle: 'double',
      enabled: true,
    },
  },
  {
    key: 'idle-3-days',
    rule: {
      field: 'idleHours',
      operator: 'gte',
      value: '72',
      tone: 'warning',
      markStyle: 'dashed',
      enabled: true,
    },
  },
  {
    key: 'mine-without-reviewer',
    rule: {
      field: 'participants',
      operator: 'eq',
      value: '0',
      tone: 'warning',
      markStyle: 'dashed',
      enabled: true,
    },
  },
  {
    key: 'assigned-unreviewed',
    rule: {
      field: 'myReviewState',
      operator: 'eq',
      value: 'unreviewed',
      tone: 'warning',
      markStyle: 'dashed',
      enabled: true,
    },
  },
];

/** As regras de destaque de linha escolhidas por quem olha, lembradas entre sessões. */
@Injectable({ providedIn: 'root' })
export class RowRulesService {
  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly stored: WritableSignal<readonly HighlightRule[]> = signal<
    readonly HighlightRule[]
  >(parseRules(this.store.read('rowRules')));

  public readonly rules: Signal<readonly HighlightRule[]> = this.stored.asReadonly();

  public add(rule: NewHighlightRule): void {
    this.save([...this.stored(), { ...rule, id: uniqueId() }]);
  }

  public update(id: string, patch: Partial<HighlightRule>): void {
    this.save(
      this.stored().map((rule) => (rule.id === id ? { ...rule, ...patch, id: rule.id } : rule)),
    );
  }

  /** Troca a regra de lugar com a vizinha. Fora da ponta ou com id
   * desconhecido, não muda nada e não grava. */
  public move(id: string, delta: -1 | 1): void {
    const rules = this.stored();
    const from = rules.findIndex((rule) => rule.id === id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= rules.length) return;

    const next = [...rules];
    const moved = next[from];
    const neighbour = next[to];
    if (moved === undefined || neighbour === undefined) return;
    next[from] = neighbour;
    next[to] = moved;
    this.save(next);
  }

  public remove(id: string): void {
    this.save(this.stored().filter((rule) => rule.id !== id));
  }

  public toneFor(facts: RowFactsModel): RuleTone | null {
    return firstTone(this.stored(), facts);
  }

  public matchFor(facts: RowFactsModel): HighlightRule | null {
    return firstMatch(this.stored(), facts);
  }

  private save(rules: readonly HighlightRule[]): void {
    this.stored.set(rules);
    this.store.write('rowRules', rules);
  }
}

function parseRules(value: unknown): readonly HighlightRule[] {
  return Array.isArray(value)
    ? value.filter(isRule).map((rule) => ({ ...rule, markStyle: markStyleOf(rule) }))
    : [];
}

/** Descarta o que o código atual não sabe ler: um fato que deixou de existir
 * não pode derrubar o painel nem virar uma regra que casa com tudo. O
 * `markStyle` é a exceção: ausente ou inválido, a regra fica e `parseRules` o
 * normaliza. */
export function isRule(item: unknown): item is HighlightRule {
  if (typeof item !== 'object' || item === null) return false;
  const rule = item as Record<string, unknown>;
  return (
    typeof rule['id'] === 'string' &&
    typeof rule['field'] === 'string' &&
    Object.hasOwn(RULE_FIELD_KINDS, rule['field']) &&
    typeof rule['operator'] === 'string' &&
    (RULE_OPERATORS as readonly string[]).includes(rule['operator']) &&
    typeof rule['value'] === 'string' &&
    typeof rule['tone'] === 'string' &&
    (RULE_TONES as readonly string[]).includes(rule['tone']) &&
    typeof rule['enabled'] === 'boolean'
  );
}
