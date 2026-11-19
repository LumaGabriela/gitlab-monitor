import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Signal,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  HighlightRule,
  REVIEW_STATE_SUGGESTIONS,
  RULE_FIELDS,
  RULE_FIELD_KINDS,
  RULE_TONES,
  RuleField,
  RuleOperator,
  RuleTone,
  defaultValueFor,
  keepOperator,
  matches,
  operatorsFor,
} from '../../../core/rules/rule-engine';
import {
  NewHighlightRule,
  ROW_RULE_SUGGESTIONS,
  RowRulesService,
  RuleSuggestion,
} from '../../../core/services/row-rules.service';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { translatedOr } from '../../../shared/monitor/cell-text';
import { CardComponent } from '../../../shared/ui/card/card.component';
import { BadgeComponent } from '../../../shared/ui/badge/badge.component';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';
import { CheckboxComponent } from '../../../shared/ui/checkbox/checkbox.component';
import { EmptyStateComponent } from '../../../shared/ui/empty-state/empty-state.component';
import { FieldComponent } from '../../../shared/ui/field/field.component';
import { SelectComponent } from '../../../shared/ui/select/select.component';
import { SelectOption } from '../../../shared/ui/select/select.model';
import { TextInputComponent } from '../../../shared/ui/text-input/text-input.component';

/** Pausa entre apagar e repor o aviso: sem ela o texto não muda e o leitor de tela não repete. */
const REANNOUNCE_MS = 100;
/** Quanto o aviso fica na tela antes de sumir. */
const SAVED_VISIBLE_MS = 3000;

/** O que o botão "Adicionar regra" cria: não casa com nada até a pessoa preencher o valor. */
const BLANK_RULE: NewHighlightRule = {
  field: 'likes',
  operator: 'gte',
  value: '',
  tone: 'warning',
  enabled: true,
};

/** Os campos cujo valor é texto: são eles que ganham sugestão do que os MRs
 * mostram agora. Número compara contagem, e booleano é sim ou não. */
const TEXT_FIELDS: readonly RuleField[] = RULE_FIELDS.filter(
  (field: RuleField): boolean => RULE_FIELD_KINDS[field] === 'text',
);

const NUMBER_FIELDS: readonly RuleField[] = RULE_FIELDS.filter(
  (field: RuleField): boolean => RULE_FIELD_KINDS[field] === 'number',
);

interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * Regras que pintam a linha inteira da tabela. Preferência local, sem botão
 * Salvar: toda mudança vale na hora e é avisada em `role="status"`.
 *
 * **A regra se explica enquanto é escrita.** O bloco repete a borda que a
 * linha destacada vai ter na tabela (mesmo traço, mesma cor que `$row-marks`),
 * e o selo ao lado do ligar/desligar diz quantos dos MRs em tela a regra casa
 * agora — é o que separa a regra que destaca o que importa da que não casa com
 * nada ou pinta a tabela inteira.
 *
 * **O valor é escolhido, não adivinhado.** O que a comparação aceita sai do
 * tipo do campo (`operatorsFor`), e o campo Valor muda de controle com ele:
 * sim/não para booleano, e a lista do que o GitLab devolveu agora (pipelines,
 * autores, estados de revisão) para texto. Sem nenhuma linha coletada não há o
 * que sugerir, e aí o valor volta a ser texto livre.
 */
@Component({
  selector: 'app-highlights-section',
  imports: [
    CardComponent,
    BadgeComponent,
    ButtonDirective,
    CheckboxComponent,
    EmptyStateComponent,
    FieldComponent,
    SelectComponent,
    TextInputComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card>
      <section class="ui-settings-section" id="destaques">
        <h2 class="ui-settings-section__title" data-focus-target tabindex="-1">
          {{ 'settings.highlights' | translate }}
        </h2>
        <p class="ui-settings__hint">{{ 'settings.highlights-summary' | translate }}</p>

        @if (rules().length) {
          <ol class="ui-settings__rules">
            @for (rule of rules(); track rule.id) {
              @let position = $index + 1;
              <li>
                <app-card
                  padding="sm"
                  class="ui-settings__rule"
                  [attr.data-rule]="rule.id"
                  [attr.data-tone]="rule.tone"
                >
                  <div class="ui-settings__rule-body">
                    <div class="ui-settings__rule-head">
                      <app-checkbox
                        [label]="'settings.rule-enabled' | translate: { position }"
                        [value]="rule.enabled"
                        (valueChange)="change(rule.id, { enabled: $event })"
                      />
                      @if (total()) {
                        <app-badge data-test="rule-matches" [tone]="rule.tone">
                          {{
                            'settings.rule-matches'
                              | translate: { count: count(rule), total: total() }
                          }}
                        </app-badge>
                      }
                      <button
                        type="button"
                        class="ui-settings__rule-remove"
                        appButton
                        variant="ghost"
                        data-test="rule-remove"
                        [attr.aria-label]="'settings.rule-remove' | translate: { position }"
                        (click)="remove(rule.id)"
                      >
                        {{ 'settings.remove' | translate }}
                      </button>
                    </div>

                    <div class="ui-settings__fields">
                      <app-field [label]="'settings.rule-field' | translate">
                        <app-select
                          data-test="rule-field"
                          [options]="fieldOptions()"
                          [value]="rule.field"
                          (valueChange)="onField(rule, $event)"
                        />
                      </app-field>
                      <app-field [label]="'settings.rule-operator' | translate">
                        <app-select
                          data-test="rule-operator"
                          [options]="operatorOptions(rule.field)"
                          [value]="rule.operator"
                          (valueChange)="onOperator(rule.id, $event)"
                        />
                      </app-field>
                      <app-field
                        [label]="'settings.rule-value' | translate"
                        [hint]="valueHint(rule.field)"
                      >
                        @if (choices(rule); as options) {
                          <app-select
                            data-test="rule-value"
                            [options]="options"
                            [value]="rule.value"
                            [placeholder]="'settings.rule-value-choose' | translate"
                            (valueChange)="change(rule.id, { value: $event })"
                          />
                        } @else {
                          <app-text-input
                            data-test="rule-value"
                            [numeric]="isNumber(rule.field)"
                            [value]="rule.value"
                            (valueChange)="change(rule.id, { value: $event })"
                          />
                        }
                      </app-field>
                      <app-field [label]="'settings.rule-tone' | translate">
                        <app-select
                          data-test="rule-tone"
                          [options]="toneOptions()"
                          [value]="rule.tone"
                          (valueChange)="onTone(rule.id, $event)"
                        />
                      </app-field>
                    </div>
                  </div>
                </app-card>
              </li>
            }
          </ol>
        } @else {
          <app-empty-state [message]="'settings.rules-empty' | translate" />
        }

        <div class="ui-settings__actions ui-settings__actions--start">
          <button
            type="button"
            appButton
            variant="outline"
            data-test="rule-add"
            (click)="add(blank)"
          >
            {{ 'settings.add-rule' | translate }}
          </button>
        </div>

        <div role="group" [attr.aria-label]="'settings.suggestions' | translate">
          <p class="ui-settings__hint">{{ 'settings.suggestions' | translate }}</p>
          <div class="ui-settings__actions ui-settings__actions--start">
            @for (suggestion of suggestions; track suggestion.key) {
              <button
                type="button"
                appButton
                variant="ghost"
                [attr.data-suggestion]="suggestion.key"
                (click)="add(suggestion.rule)"
              >
                {{ 'settings.suggestion-' + suggestion.key | translate }}
              </button>
            }
          </div>
        </div>

        <!-- Sempre no DOM: uma região viva só anuncia o que muda dentro dela. -->
        <p class="ui-settings__saved" role="status" aria-live="polite">
          @if (saved()) {
            {{ 'settings.saved' | translate }}
          }
        </p>
      </section>
    </app-card>
  `,
})
export class HighlightsSectionComponent {
  private readonly rowRules = inject(RowRulesService);
  private readonly monitor = inject(GitlabMonitorService);
  protected readonly rules: Signal<readonly HighlightRule[]> = this.rowRules.rules;

  private readonly translate = inject(TranslateService);
  private readonly destroyRef: DestroyRef = inject(DestroyRef);
  private timers: ReturnType<typeof setTimeout>[] = [];
  // O catálogo chega por HTTP depois da primeira renderização: sem esta
  // dependência, as opções ficariam presas ao que existia antes dele carregar.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  protected readonly blank: NewHighlightRule = BLANK_RULE;
  protected readonly suggestions: readonly RuleSuggestion[] = ROW_RULE_SUGGESTIONS;
  protected readonly saved: WritableSignal<boolean> = signal<boolean>(false);

  protected readonly fieldOptions: Signal<readonly SelectOption[]> = computed(() =>
    this.options<RuleField>(RULE_FIELDS, 'rule-field-'),
  );
  protected readonly toneOptions: Signal<readonly SelectOption[]> = computed(() =>
    this.options<RuleTone>(RULE_TONES, 'rule-tone-'),
  );

  /** Quantos MRs o painel mostra agora: é o denominador do selo de cada regra. */
  protected readonly total: Signal<number> = computed((): number => this.monitor.rows().length);

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

  public constructor() {
    this.destroyRef.onDestroy((): void => this.clearTimers());
  }

  /** Só os operadores que o tipo do campo compara: "maior ou igual" a um
   * autor nunca casaria, e oferecê-lo seria oferecer uma regra morta. */
  protected operatorOptions(field: RuleField): readonly SelectOption[] {
    return this.options<RuleOperator>(operatorsFor(field), 'rule-op-');
  }

  /**
   * As opções do campo Valor, ou `null` quando não há o que oferecer e ele
   * volta a ser texto livre. Booleano é sempre sim ou não; texto só vira lista
   * quando o monitor já viu algum valor — sem linha coletada, uma lista com o
   * valor guardado e mais nada impediria de escrever outro.
   */
  protected choices(rule: HighlightRule): readonly SelectOption[] | null {
    this.language();
    if (RULE_FIELD_KINDS[rule.field] === 'boolean') {
      return [
        { value: 'true', label: String(this.translate.instant('common.yes')) },
        { value: 'false', label: String(this.translate.instant('common.no')) },
      ];
    }
    const suggested = this.suggestedValues(rule.field);
    if (!suggested.length) return null;
    // O valor guardado entra mesmo que nenhum MR em tela o mostre: a regra
    // continua valendo, e some-lo do select a apagaria no primeiro clique.
    const value = rule.value.trim();
    const values = value && !suggested.includes(value) ? [value, ...suggested] : suggested;
    return values.map((item: string): SelectOption => ({
      value: item,
      label: this.valueLabel(rule.field, item),
    }));
  }

  /** Campo de número compara número: o valor só aceita dígitos. */
  protected isNumber(field: RuleField): boolean {
    return RULE_FIELD_KINDS[field] === 'number';
  }

  /** Em que faixa o número do campo está agora; `null` quando não é número ou
   * nada foi coletado ainda. */
  protected valueHint(field: RuleField): string | null {
    this.language();
    const range = this.ranges()[field];
    if (!range) return null;
    return String(this.translate.instant('settings.rule-range', range));
  }

  /** Quantos MRs em tela a regra casa agora, ligada ou não: é a conferência de
   * que ela faz o que promete antes de ligá-la. */
  protected count(rule: HighlightRule): number {
    return this.monitor.rows().filter((row): boolean => matches(rule, row.facts)).length;
  }

  protected add(rule: NewHighlightRule): void {
    this.rowRules.add(rule);
    this.announceSaved();
  }

  protected change(id: string, patch: Partial<HighlightRule>): void {
    this.rowRules.update(id, patch);
    this.announceSaved();
  }

  /**
   * Trocar de campo não deixa a regra num estado que não compara: o operador
   * só fica se o tipo novo o aceitar, e o valor recomeça, porque o anterior
   * comparava outra coisa ("failed" não é um número de likes).
   */
  protected onField(rule: HighlightRule, value: string): void {
    const field = value as RuleField;
    if (field === rule.field) return;
    this.change(rule.id, {
      field,
      operator: keepOperator(field, rule.operator),
      value: defaultValueFor(field),
    });
  }

  // Os selects só oferecem os valores das listas acima, então o texto que chega é um deles.
  protected onOperator(id: string, value: string): void {
    this.change(id, { operator: value as RuleOperator });
  }

  protected onTone(id: string, value: string): void {
    this.change(id, { tone: value as RuleTone });
  }

  protected remove(id: string): void {
    this.rowRules.remove(id);
    this.announceSaved();
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
    if (field === 'myReviewState') {
      return translatedOr(this.translate, `settings.rule-review-${key}`, value);
    }
    return value;
  }

  /**
   * Uma região viva só anuncia o que MUDA: com o texto fixo, a segunda
   * alteração passaria calada. Por isso o aviso some e volta a cada
   * alteração, e some de vez depois de um tempo curto.
   */
  private announceSaved(): void {
    this.clearTimers();
    this.saved.set(false);
    this.timers = [
      setTimeout((): void => this.saved.set(true), REANNOUNCE_MS),
      setTimeout((): void => this.saved.set(false), REANNOUNCE_MS + SAVED_VISIBLE_MS),
    ];
  }

  private clearTimers(): void {
    this.timers.forEach((timer): void => clearTimeout(timer));
    this.timers = [];
  }

  private options<T extends string>(values: readonly T[], prefix: string): SelectOption[] {
    this.language();
    return values.map((value) => ({
      value,
      label: String(this.translate.instant(`settings.${prefix}${value}`)),
    }));
  }
}
