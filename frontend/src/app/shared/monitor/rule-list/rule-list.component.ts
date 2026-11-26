import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  OutputEmitterRef,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import {
  RuleField,
  RuleMarkStyle,
  RuleMode,
  RuleOperator,
  RuleTone,
  defaultValueFor,
  keepOperator,
  markStyleOf,
} from '../../../core/rules/rule-engine';
import { RuleDraft, RuleListContext } from '../../../core/services/rule-editor.service';
import { BadgeComponent } from '../../ui/badge/badge.component';
import { ButtonDirective } from '../../ui/button/button.directive';
import { CheckboxComponent } from '../../ui/checkbox/checkbox.component';
import { EmptyStateComponent } from '../../ui/empty-state/empty-state.component';
import { FieldComponent } from '../../ui/field/field.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { IconButtonDirective } from '../../ui/icon-button/icon-button.directive';
import { MultiSelectComponent } from '../../ui/multi-select/multi-select.component';
import { SelectComponent } from '../../ui/select/select.component';
import { TextInputComponent } from '../../ui/text-input/text-input.component';

/** O que o editor sabe editar; a tela decide o resto do item. */
export interface EditableRule extends RuleDraft {
  readonly id: string;
  readonly enabled: boolean;
  readonly tone?: RuleTone;
  readonly markStyle?: RuleMarkStyle;
  readonly mode?: RuleMode;
  readonly kinds?: readonly string[];
}

export interface RuleChange {
  readonly id: string;
  readonly patch: Partial<EditableRule>;
}

/**
 * Editor de uma lista de regras: o mesmo componente desenha os destaques de
 * linha e os critérios de aviso, e quem o usa liga o que precisa por
 * `appearance`, `showMode` e `showKinds`.
 *
 * Burro de propósito: não injeta serviço nem guarda estado. O que o editor
 * precisa saber (opções, o que os MRs em tela mostram, quantos casam) chega em
 * `context`, e toda alteração sai como evento; quem grava é a tela.
 */
@Component({
  selector: 'app-rule-list',
  imports: [
    BadgeComponent,
    ButtonDirective,
    CheckboxComponent,
    EmptyStateComponent,
    FieldComponent,
    IconButtonDirective,
    IconComponent,
    MultiSelectComponent,
    SelectComponent,
    TextInputComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (rules().length) {
      <ol class="ui-rule-list">
        @for (rule of rules(); track rule.id) {
          @let position = $index + 1;
          @let isFirst = $first;
          @let isLast = $last;
          <li [class]="ruleClasses(rule)" [attr.data-rule]="rule.id">
            <div class="ui-rule-list__head">
              @if (ordered()) {
                <!-- O dígito sozinho não se explica no leitor de tela: ele fica
                     escondido e a frase inteira vai em texto só para leitor. -->
                <span class="ui-rule-list__position" data-test="rule-position" aria-hidden="true">{{
                  position
                }}</span>
                <span class="ui-visually-hidden" data-test="rule-position-label">{{
                  'settings.rule-position' | translate: { position, total: rules().length }
                }}</span>
              }
              <app-checkbox
                [label]="'settings.rule-enabled' | translate: { position }"
                [value]="rule.enabled"
                (valueChange)="change(rule.id, { enabled: $event })"
              />
              <!-- Conta MRs em tela, não eventos: é a comparação que ele mede, e
                   por isso ignora o modo e os tipos, que escolhem a que avisos a
                   regra se aplica e não a quais MRs ela casa. O painel não tem
                   uma lista de eventos para contar. -->
              @if (context().total) {
                @let matched = context().matchCount(rule);
                @let covered = coveredBy($index, rule);
                @if (matched > 0 && covered === matched) {
                  <app-badge data-test="rule-matches" tone="neutral">
                    {{ 'settings.rule-fully-covered' | translate: { count: matched } }}
                  </app-badge>
                } @else {
                  <app-badge data-test="rule-matches" [tone]="rule.tone ?? 'neutral'">
                    {{
                      'settings.rule-matches'
                        | translate: { count: matched, total: context().total }
                    }}
                    @if (covered > 0) {
                      {{ 'settings.rule-covered' | translate: { count: covered } }}
                    }
                  </app-badge>
                }
              }
              @if (ordered()) {
                <span class="ui-rule-list__moves">
                  <button
                    type="button"
                    appIconButton
                    size="sm"
                    data-move="-1"
                    [label]="'settings.rule-move-up' | translate: { position }"
                    [disabled]="isFirst"
                    (click)="moveRule.emit({ id: rule.id, delta: -1 })"
                  >
                    <app-icon name="arrow-up" />
                  </button>
                  <button
                    type="button"
                    appIconButton
                    size="sm"
                    data-move="1"
                    [label]="'settings.rule-move-down' | translate: { position }"
                    [disabled]="isLast"
                    (click)="moveRule.emit({ id: rule.id, delta: 1 })"
                  >
                    <app-icon name="arrow-down" />
                  </button>
                </span>
              }
              <button
                type="button"
                class="ui-rule-list__remove"
                appButton
                variant="outline"
                data-test="rule-remove"
                [attr.aria-label]="'settings.rule-remove' | translate: { position }"
                (click)="ruleRemove.emit(rule.id)"
              >
                {{ 'settings.remove' | translate }}
              </button>
            </div>

            <div class="ui-settings__fields">
              <app-field [label]="'settings.rule-field' | translate">
                <app-select
                  data-test="rule-field"
                  [options]="context().fieldOptions"
                  [value]="rule.field"
                  (valueChange)="changeField(rule, $event)"
                />
              </app-field>
              <app-field [label]="'settings.rule-operator' | translate">
                <app-select
                  data-test="rule-operator"
                  [options]="context().operatorOptions(rule.field)"
                  [value]="rule.operator"
                  (valueChange)="changeOperator(rule.id, $event)"
                />
              </app-field>
              <app-field
                [label]="'settings.rule-value' | translate"
                [hint]="context().valueHint(rule.field)"
              >
                @if (context().valueChoices(rule); as options) {
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
                    [numeric]="context().isNumber(rule.field)"
                    [value]="rule.value"
                    (valueChange)="change(rule.id, { value: $event })"
                  />
                }
              </app-field>
              @if (appearance()) {
                <app-field [label]="'settings.rule-tone' | translate">
                  <app-select
                    data-test="rule-tone"
                    [options]="context().toneOptions"
                    [value]="rule.tone ?? ''"
                    (valueChange)="changeTone(rule.id, $event)"
                  />
                </app-field>
                <app-field [label]="'settings.rule-mark' | translate">
                  <app-select
                    data-test="rule-mark"
                    [options]="context().markStyleOptions"
                    [value]="rule.markStyle ?? ''"
                    (valueChange)="changeMarkStyle(rule.id, $event)"
                  />
                </app-field>
              }
              @if (showMode()) {
                <app-field [label]="'settings.rule-mode' | translate">
                  <app-select
                    data-test="rule-mode"
                    [options]="context().modeOptions"
                    [value]="rule.mode ?? ''"
                    (valueChange)="changeMode(rule.id, $event)"
                  />
                </app-field>
              }
              @if (showKinds()) {
                <app-field [label]="'settings.rule-kinds' | translate">
                  <app-multi-select
                    data-test="rule-kinds"
                    [options]="context().kindOptions"
                    [value]="rule.kinds ?? []"
                    [placeholder]="'settings.rule-kinds-all' | translate"
                    (valueChange)="change(rule.id, { kinds: $event })"
                  />
                </app-field>
              }
            </div>
          </li>
        }
      </ol>
    } @else {
      <app-empty-state [message]="emptyMessage()" />
    }

    <div class="ui-settings__actions ui-settings__actions--start ui-rule-list__add">
      <button
        type="button"
        appButton
        variant="primary"
        data-test="rule-add"
        (click)="ruleAdd.emit()"
      >
        {{ 'settings.add-rule' | translate }}
      </button>
    </div>
  `,
})
export class RuleListComponent {
  public readonly rules: InputSignal<readonly EditableRule[]> =
    input.required<readonly EditableRule[]>();
  public readonly context: InputSignal<RuleListContext> = input.required<RuleListContext>();
  /** Mostra Cor e Traço. */
  public readonly appearance: InputSignal<boolean> = input<boolean>(false);
  /** Mostra o select de modo (notificar/silenciar). */
  public readonly showMode: InputSignal<boolean> = input<boolean>(false);
  /** Mostra o multi-select de tipos de evento. */
  public readonly showKinds: InputSignal<boolean> = input<boolean>(false);
  /** Mostra a posição e as setas: só onde a ordem da lista é a precedência. */
  public readonly ordered: InputSignal<boolean> = input<boolean>(false);
  /** Já traduzida por quem usa: o que diz o estado vazio depende da tela. */
  public readonly emptyMessage: InputSignal<string> = input<string>('');

  public readonly ruleChange: OutputEmitterRef<RuleChange> = output<RuleChange>();
  public readonly ruleRemove: OutputEmitterRef<string> = output<string>();
  public readonly ruleAdd: OutputEmitterRef<void> = output<void>();
  public readonly moveRule: OutputEmitterRef<{ id: string; delta: -1 | 1 }> = output<{
    id: string;
    delta: -1 | 1;
  }>();

  /** O bloco repete a borda que a linha vai ter na tabela: a classe do tom dá
   * a cor e a do traço dá o desenho e a espessura (`_settings.scss`). */
  protected ruleClasses(rule: EditableRule): string {
    if (!rule.tone) return 'ui-rule-list__rule';
    const mark = markStyleOf({ tone: rule.tone, markStyle: rule.markStyle });
    return `ui-rule-list__rule ui-rule-list__rule--tone-${rule.tone} ui-rule-list__rule--mark-${mark}`;
  }

  /** Quantos dos MRs que a regra casa já são pintados por uma regra ligada
   * acima dela: regra desligada não pinta nada, então não cobre. */
  protected coveredBy(index: number, rule: EditableRule): number {
    // Sem ordem não há "acima": em avisos a lista não é precedência.
    if (!this.ordered()) return 0;
    const above: readonly EditableRule[] = this.rules()
      .slice(0, index)
      .filter((item: EditableRule): boolean => item.enabled);
    return above.length ? this.context().coveredCount(above, rule) : 0;
  }

  protected change(id: string, patch: Partial<EditableRule>): void {
    this.ruleChange.emit({ id, patch });
  }

  /**
   * Trocar de campo não deixa a regra num estado que não compara: o operador
   * só fica se o tipo novo o aceitar, e o valor recomeça, porque o anterior
   * comparava outra coisa ("failed" não é um número de likes).
   */
  protected changeField(rule: EditableRule, value: string): void {
    const field = value as RuleField;
    if (field === rule.field) return;
    this.change(rule.id, {
      field,
      operator: keepOperator(field, rule.operator),
      value: defaultValueFor(field),
    });
  }

  // Os selects só oferecem os valores das listas do contexto, então o texto que chega é um deles.
  protected changeOperator(id: string, value: string): void {
    this.change(id, { operator: value as RuleOperator });
  }

  protected changeTone(id: string, value: string): void {
    this.change(id, { tone: value as RuleTone });
  }

  protected changeMarkStyle(id: string, value: string): void {
    this.change(id, { markStyle: value as RuleMarkStyle });
  }

  protected changeMode(id: string, value: string): void {
    this.change(id, { mode: value as RuleMode });
  }
}
