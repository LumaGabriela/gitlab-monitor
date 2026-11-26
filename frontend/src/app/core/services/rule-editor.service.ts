import { Injectable, Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslateService } from '@ngx-translate/core';
import {
  REVIEW_STATE_SUGGESTIONS,
  RULE_FIELDS,
  RULE_FIELD_KINDS,
  RULE_MARK_STYLES,
  RULE_MODES,
  RULE_TONES,
  RuleField,
  RuleMarkStyle,
  RuleMode,
  RuleCriterion,
  RuleOperator,
  RuleTone,
  matches,
  operatorsFor,
} from '../rules/rule-engine';
import { translatedOr } from '../i18n/translated-or';
import { PanelEventKind } from '../models/api/panel-api.model';
import { GitlabMonitorService } from './gitlab-monitor.service';
import { NOTIFY_EVENT_KINDS } from './notify-rules.service';

/** `core/` não importa do Design System (§3), então declara a sua própria
 * opção, estruturalmente compatível com `SelectOption`. A trava é
 * `shared/monitor/rule-option-contract.spec.ts`, que só compila enquanto toda
 * `RuleOption` couber num `SelectOption` (um sentido só) — o mesmo acordo de
 * `cell-contract.spec.ts`. */
export interface RuleOption {
  readonly value: string;
  readonly label: string;
}

/** A comparação de uma regra, sem o que a decora (tom, traço, ligada). */
export type RuleDraft = RuleCriterion;

/** Tudo que o editor de regras precisa saber para desenhar as listas: as
 * opções de cada select e o que os MRs em tela mostram agora. */
export interface RuleListContext {
  /** Quantos MRs o painel mostra agora: é o denominador do selo de cada regra. */
  readonly total: number;
  readonly fieldOptions: readonly RuleOption[];
  readonly toneOptions: readonly RuleOption[];
  readonly markStyleOptions: readonly RuleOption[];
  readonly modeOptions: readonly RuleOption[];
  readonly kindOptions: readonly RuleOption[];
  readonly operatorOptions: (field: RuleField) => readonly RuleOption[];
  /** `null` quando o campo é texto livre: nada observado para oferecer. */
  readonly valueChoices: (draft: RuleDraft) => readonly RuleOption[] | null;
  readonly valueHint: (field: RuleField) => string | null;
  readonly isNumber: (field: RuleField) => boolean;
  readonly matchCount: (draft: RuleDraft) => number;
  /** Quantos MRs em tela casam com `draft` e também com alguma comparação de
   * `above`: os que uma regra acima já pinta. */
  readonly coveredCount: (above: readonly RuleDraft[], draft: RuleDraft) => number;
}

interface Range {
  readonly min: number;
  readonly max: number;
}

/** Os campos cujo valor é texto: são eles que ganham sugestão do que os MRs
 * mostram agora. Número compara contagem, e booleano é sim ou não. */
const TEXT_FIELDS: readonly RuleField[] = RULE_FIELDS.filter(
  (field: RuleField): boolean => RULE_FIELD_KINDS[field] === 'text',
);

const NUMBER_FIELDS: readonly RuleField[] = RULE_FIELDS.filter(
  (field: RuleField): boolean => RULE_FIELD_KINDS[field] === 'number',
);

/**
 * O que a tela de regras sabe e a regra não: os valores que os MRs em tela
 * mostram, a faixa de cada número e quantas linhas uma comparação casa.
 * Vive em `core/` para o editor, que é um componente burro de `shared/`, e as
 * telas que o usam consumirem o mesmo objeto sem cada uma recalcular.
 */
@Injectable({ providedIn: 'root' })
export class RuleEditorService {
  private readonly monitor = inject(GitlabMonitorService);
  private readonly translate = inject(TranslateService);
  // O catálogo chega por HTTP depois da primeira renderização: sem esta
  // dependência, os rótulos ficariam presos ao que existia antes dele carregar.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  /** Os valores que os MRs em tela trazem em cada campo de texto. É daqui que
   * saem as sugestões: pipeline, autor e estado de revisão existentes, e não
   * uma lista fixa que envelhece junto com o GitLab. */
  private readonly observed: Signal<Readonly<Record<string, readonly string[]>>> = computed(
    (): Readonly<Record<string, readonly string[]>> => {
      const found = new Map<RuleField, Set<string>>();
      for (const row of this.monitor.rows()) {
        for (const field of TEXT_FIELDS) {
          const value = String(row.facts[field] ?? '').trim();
          if (!value) continue;
          const set = found.get(field) ?? new Set<string>();
          set.add(value);
          found.set(field, set);
        }
      }
      const result: Record<string, readonly string[]> = {};
      found.forEach((values, field): void => {
        result[field] = [...values].sort((a, b) => a.localeCompare(b));
      });
      return result;
    },
  );

  /** O intervalo que cada campo numérico ocupa nos MRs em tela, para a ajuda
   * do campo Valor dizer em que faixa um número faz diferença. */
  private readonly ranges: Signal<Readonly<Record<string, Range>>> = computed(
    (): Readonly<Record<string, Range>> => {
      const result: Record<string, Range> = {};
      const rows = this.monitor.rows();
      if (!rows.length) return result;
      for (const field of NUMBER_FIELDS) {
        const values = rows.map((row): number => Math.round(Number(row.facts[field]) || 0));
        result[field] = { min: Math.min(...values), max: Math.max(...values) };
      }
      return result;
    },
  );

  public readonly context: Signal<RuleListContext> = computed((): RuleListContext => {
    this.language();
    const rows = this.monitor.rows();
    const ranges = this.ranges();
    return {
      total: rows.length,
      fieldOptions: this.options<RuleField>(RULE_FIELDS, 'rule-field-'),
      toneOptions: this.options<RuleTone>(RULE_TONES, 'rule-tone-'),
      markStyleOptions: this.options<RuleMarkStyle>(RULE_MARK_STYLES, 'rule-mark-'),
      modeOptions: this.options<RuleMode>(RULE_MODES, 'rule-mode-'),
      kindOptions: this.options<PanelEventKind>(NOTIFY_EVENT_KINDS, 'notify-kind-'),
      // Só os operadores que o tipo do campo compara: "maior ou igual" a um
      // autor nunca casaria, e oferecê-lo seria oferecer uma regra morta.
      operatorOptions: (field: RuleField): readonly RuleOption[] =>
        this.options<RuleOperator>(operatorsFor(field), 'rule-op-'),
      valueChoices: (draft: RuleDraft): readonly RuleOption[] | null => this.choices(draft),
      // Em que faixa o número do campo está agora; `null` quando não é número
      // ou nada foi coletado ainda.
      valueHint: (field: RuleField): string | null => {
        const range = ranges[field];
        if (!range) return null;
        return String(this.translate.instant('settings.rule-range', range));
      },
      // Campo de número compara número: o valor só aceita dígitos.
      isNumber: (field: RuleField): boolean => RULE_FIELD_KINDS[field] === 'number',
      // Quantos MRs em tela a comparação casa agora, ligada ou não: é a
      // conferência de que ela faz o que promete antes de ligá-la.
      matchCount: (draft: RuleDraft): number =>
        rows.filter((row): boolean => matches(draft, row.facts)).length,
      coveredCount: (above: readonly RuleDraft[], draft: RuleDraft): number =>
        rows.filter(
          (row): boolean =>
            matches(draft, row.facts) &&
            above.some((rule: RuleDraft): boolean => matches(rule, row.facts)),
        ).length,
    };
  });

  /**
   * As opções do campo Valor, ou `null` quando não há o que oferecer e ele
   * volta a ser texto livre. Booleano é sempre sim ou não; texto só vira lista
   * quando o monitor já viu algum valor — sem linha coletada, uma lista com o
   * valor guardado e mais nada impediria de escrever outro.
   */
  private choices(draft: RuleDraft): readonly RuleOption[] | null {
    if (RULE_FIELD_KINDS[draft.field] === 'boolean') {
      return [
        { value: 'true', label: String(this.translate.instant('common.yes')) },
        { value: 'false', label: String(this.translate.instant('common.no')) },
      ];
    }
    const suggested = this.suggestedValues(draft.field);
    if (!suggested.length) return null;
    // O valor guardado entra mesmo que nenhum MR em tela o mostre: a regra
    // continua valendo, e some-lo do select a apagaria no primeiro clique.
    const value = draft.value.trim();
    const values = value && !suggested.includes(value) ? [value, ...suggested] : suggested;
    return values.map((item: string): RuleOption => ({
      value: item,
      label: this.valueLabel(draft.field, item),
    }));
  }

  /** O que sugerir para um campo de texto: o que os MRs mostram agora e, no
   * estado de revisão, também os nomes que o GitLab escreve — eles só aparecem
   * nas linhas em que sou revisora, e não estariam lá para escolher. */
  private suggestedValues(field: RuleField): readonly string[] {
    const observed = this.observed()[field] ?? [];
    if (field !== 'myReviewState') return observed;
    const extra = observed.filter(
      (value: string): boolean => !REVIEW_STATE_SUGGESTIONS.includes(value),
    );
    return [...REVIEW_STATE_SUGGESTIONS, ...extra];
  }

  /** O rótulo do valor no idioma ativo; o valor cru quando o catálogo não tem
   * a chave — é o mesmo acordo das células da tabela. */
  private valueLabel(field: RuleField, value: string): string {
    const key = value.replace(/_/g, '-');
    if (field === 'pipeline') return translatedOr(this.translate, `pipeline.${key}`, value);
    if (field === 'myReviewState')
      return translatedOr(this.translate, `settings.rule-review-${key}`, value);
    return value;
  }

  private options<T extends string>(values: readonly T[], prefix: string): RuleOption[] {
    return values.map((value: T): RuleOption => ({
      value,
      label: translatedOr(this.translate, `settings.${prefix}${value}`, value),
    }));
  }
}
