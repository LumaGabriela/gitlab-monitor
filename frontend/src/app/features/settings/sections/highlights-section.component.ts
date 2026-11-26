import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  Signal,
  WritableSignal,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { DEFAULT_MARK_STYLE, HighlightRule } from '../../../core/rules/rule-engine';
import {
  NewHighlightRule,
  ROW_RULE_SUGGESTIONS,
  RowRulesService,
  RuleSuggestion,
} from '../../../core/services/row-rules.service';
import { RuleEditorService, RuleListContext } from '../../../core/services/rule-editor.service';
import {
  EditableRule,
  RuleChange,
  RuleListComponent,
} from '../../../shared/monitor/rule-list/rule-list.component';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';

/** O que se pode alterar numa regra de destaque, montada campo a campo. */
type HighlightPatch = {
  -readonly [K in keyof Omit<HighlightRule, 'id'>]?: Omit<HighlightRule, 'id'>[K];
};

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
  markStyle: DEFAULT_MARK_STYLE.warning,
  enabled: true,
};

/**
 * Regras que pintam a linha inteira da tabela. Preferência local, sem botão
 * Salvar: toda mudança vale na hora e é avisada em `role="status"`.
 *
 * **A regra se explica enquanto é escrita** (no `app-rule-list`, o editor que as
 * notificações também usam). O bloco repete a borda que a
 * linha destacada vai ter na tabela (mesmo traço, mesma cor, de `$rule-tone-colors` e `$rule-mark-widths`),
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
  imports: [ButtonDirective, RuleListComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-settings-section" id="destaques">
      <h2 class="ui-settings-section__title" data-focus-target tabindex="-1">
        {{ 'settings.highlights' | translate }}
      </h2>
      <p class="ui-settings__hint">{{ 'settings.highlights-summary' | translate }}</p>

      <app-rule-list
        [rules]="rules()"
        [context]="context()"
        [appearance]="true"
        [ordered]="true"
        [emptyMessage]="'settings.rules-empty' | translate"
        (ruleChange)="change($event)"
        (ruleRemove)="remove($event)"
        (moveRule)="move($event)"
        (ruleAdd)="add(blank)"
      />

      <div role="group" [attr.aria-label]="'settings.suggestions' | translate">
        <p class="ui-settings__hint">{{ 'settings.suggestions' | translate }}</p>
        <div class="ui-settings__actions ui-settings__actions--start">
          @for (suggestion of suggestions; track suggestion.key) {
            <button
              type="button"
              appButton
              variant="outline"
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
      <!-- A posição nova, lida da lista já reordenada. Separada do aviso de salvamento. -->
      <p class="ui-visually-hidden" role="status" aria-live="polite">{{ announcement() }}</p>
    </section>
  `,
})
export class HighlightsSectionComponent {
  private readonly rowRules = inject(RowRulesService);
  private readonly destroyRef: DestroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector: Injector = inject(Injector);
  // Sem a dependência, o texto ficaria preso ao catálogo anterior à chegada dele.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly movedId: WritableSignal<string | null> = signal<string | null>(null);

  protected readonly rules: Signal<readonly HighlightRule[]> = this.rowRules.rules;
  protected readonly context: Signal<RuleListContext> = inject(RuleEditorService).context;
  protected readonly blank: NewHighlightRule = BLANK_RULE;
  protected readonly suggestions: readonly RuleSuggestion[] = ROW_RULE_SUGGESTIONS;
  protected readonly saved: WritableSignal<boolean> = signal<boolean>(false);

  protected readonly announcement: Signal<string> = computed((): string => {
    this.language();
    const rules = this.rules();
    const index = rules.findIndex((rule) => rule.id === this.movedId());
    if (index < 0) return '';
    return this.translate.instant('settings.rule-moved', {
      position: index + 1,
      total: rules.length,
    });
  });

  public constructor() {
    this.destroyRef.onDestroy((): void => this.clearTimers());
  }

  protected add(rule: NewHighlightRule): void {
    this.movedId.set(null);
    this.rowRules.add(rule);
    this.announceSaved();
  }

  protected change(change: RuleChange): void {
    this.movedId.set(null);
    this.rowRules.update(change.id, highlightPatch(change.patch));
    this.announceSaved();
  }

  protected remove(id: string): void {
    this.movedId.set(null);
    this.rowRules.remove(id);
    this.announceSaved();
  }

  protected move(request: { id: string; delta: -1 | 1 }): void {
    this.movedId.set(request.id);
    this.rowRules.move(request.id, request.delta);
    this.announceSaved();
    // O @for move o nó da regra e a seta pode ficar desabilitada na ponta:
    // depois de renderizar, o foco volta à seta da regra movida, ou à oposta.
    afterNextRender((): void => this.restoreFocus(request.id, request.delta), {
      injector: this.injector,
    });
  }

  private restoreFocus(id: string, delta: -1 | 1): void {
    // Compara o atributo em vez de montar um seletor com o id: dispensa escape.
    const item = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('.ui-rule-list__rule'),
    ).find((element): boolean => element.getAttribute('data-rule') === id);
    const same = item?.querySelector<HTMLButtonElement>(`[data-move="${delta}"]`);
    const opposite = item?.querySelector<HTMLButtonElement>(`[data-move="${-delta}"]`);
    (same && !same.disabled ? same : opposite)?.focus();
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
}

/**
 * O que o editor emitiu, estreitado ao que uma regra de destaque tem. O editor
 * serve as duas telas, então o patch dele pode falar de `mode` e `kinds`:
 * copiar campo a campo é o que impede os dois de entrarem em `rowRules` caso
 * alguém ligue `showMode` ou `showKinds` aqui um dia — um `as` aceitaria os
 * dois calado, e o `isRule` de `RowRulesService` não rejeita chave extra.
 */
function highlightPatch(patch: Partial<EditableRule>): HighlightPatch {
  const next: HighlightPatch = {};
  if (patch.field !== undefined) next.field = patch.field;
  if (patch.operator !== undefined) next.operator = patch.operator;
  if (patch.value !== undefined) next.value = patch.value;
  if (patch.tone !== undefined) next.tone = patch.tone;
  if (patch.markStyle !== undefined) next.markStyle = patch.markStyle;
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  return next;
}
