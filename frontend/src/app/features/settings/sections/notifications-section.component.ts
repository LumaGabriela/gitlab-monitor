import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  WritableSignal,
  computed,
  inject,
  linkedSignal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PanelEventKind } from '../../../core/models/api/panel-api.model';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { NotificationsService } from '../../../core/services/notifications.service';
import {
  NOTIFY_DECIDERS,
  NOTIFY_EVENT_KINDS,
  NotifyDecider,
  NotifyRule,
  NotifyRules,
  NotifyRulesService,
} from '../../../core/services/notify-rules.service';
import { RuleEditorService, RuleListContext } from '../../../core/services/rule-editor.service';
import {
  EditableRule,
  RuleChange,
  RuleListComponent,
} from '../../../shared/monitor/rule-list/rule-list.component';
import { AlertComponent } from '../../../shared/ui/alert/alert.component';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';
import { CheckboxComponent } from '../../../shared/ui/checkbox/checkbox.component';
import { FieldComponent } from '../../../shared/ui/field/field.component';
import { MultiSelectComponent } from '../../../shared/ui/multi-select/multi-select.component';
import { SelectComponent } from '../../../shared/ui/select/select.component';
import { TextInputComponent } from '../../../shared/ui/text-input/text-input.component';

/** A janela que o horário silencioso assume ao ser ligado: a noite de trabalho. */
const DEFAULT_QUIET = { start: '19:00', end: '09:00' } as const;

/** O que se pode alterar numa regra de aviso, montado campo a campo. */
type NotifyPatch = {
  -readonly [K in keyof Omit<NotifyRule, 'id'>]?: Omit<NotifyRule, 'id'>[K];
};

/**
 * O que merece aviso no navegador, mais o interruptor geral e as ações de
 * teste e verificação. Preferência local: vale na hora, sem botão Salvar.
 *
 * **Dois modos, e só um vale por vez.** O select no topo escolhe quem decide:
 * **Geral**, um corte igual para todos os MRs (tipos, só os meus, likes
 * mínimos, rascunhos, autores silenciados), ou **Critérios**, em que só passa
 * o evento que casa com alguma regra. O lado que não está valendo aparece
 * desabilitado, com um aviso dizendo por quê: escondê-lo faria a preferência
 * guardada sumir da tela, e deixá-lo editável faria prometer o que não vale.
 *
 * **Horário de silêncio e espera entre avisos ficam fora dessa escolha**, num
 * bloco próprio: são limites de incômodo, não critérios de interesse — calar
 * a madrugada não deixa de valer porque a decisão passou para os critérios.
 *
 * O editor entra aqui sem `appearance`: cor e traço são de quem pinta a tabela,
 * e um aviso do navegador não tem borda para desenhar.
 */
@Component({
  selector: 'app-notifications-section',
  imports: [
    AlertComponent,
    ButtonDirective,
    CheckboxComponent,
    FieldComponent,
    MultiSelectComponent,
    RuleListComponent,
    SelectComponent,
    TextInputComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-settings-section" id="notificacoes">
      <h2 class="ui-settings-section__title" data-focus-target tabindex="-1">
        {{ 'settings.notifications' | translate }}
      </h2>
      <p class="ui-settings__hint">{{ 'settings.notifications-summary' | translate }}</p>

      <app-checkbox
        [label]="'settings.notify' | translate"
        [value]="notifyEnabled()"
        (valueChange)="onNotifyToggle($event)"
      />

      <div class="ui-settings__actions ui-settings__actions--start">
        <button
          type="button"
          appButton
          variant="outline"
          [disabled]="refreshing()"
          (click)="onTestNotification()"
        >
          {{ 'settings.test-notification' | translate }}
        </button>
        <button
          type="button"
          appButton
          variant="outline"
          [disabled]="refreshing()"
          [loading]="refreshing()"
          (click)="onCheckNow()"
        >
          {{ 'settings.check-now' | translate }}
        </button>
      </div>

      @if (notifyHintKey(); as key) {
        <app-alert tone="info">{{ key | translate }}</app-alert>
      }

      <div class="ui-settings__fields">
        <app-field
          [label]="'settings.notify-decider' | translate"
          [hint]="'settings.notify-decider-hint' | translate"
        >
          <app-select
            data-test="notify-decider"
            [options]="deciderOptions()"
            [value]="rules().decider"
            (valueChange)="onDeciderChange($event)"
          />
        </app-field>
      </div>

      <h3 class="ui-settings__subtitle">{{ 'settings.notify-general' | translate }}</h3>
      <p class="ui-settings__hint">{{ 'settings.notify-general-summary' | translate }}</p>
      @if (byRules()) {
        <app-alert tone="info" data-test="general-off">
          {{ 'settings.notify-general-off' | translate }}
        </app-alert>
      }

      <div class="ui-settings__fields">
        <app-field
          [label]="'settings.notify-kinds' | translate"
          [hint]="'settings.notify-kinds-hint' | translate"
        >
          <app-multi-select
            data-test="notify-kinds"
            [disabled]="byRules()"
            [options]="context().kindOptions"
            [value]="selectedKinds()"
            [placeholder]="'settings.notify-kinds-none' | translate"
            (valueChange)="onKindsChange($event)"
          />
        </app-field>
      </div>

      <app-checkbox
        [label]="'settings.notify-only-mine' | translate"
        [disabled]="byRules()"
        [value]="rules().onlyMine"
        (valueChange)="notifyRules.update({ onlyMine: $event })"
      />
      <app-checkbox
        [label]="'settings.notify-ignore-drafts' | translate"
        [disabled]="byRules()"
        [value]="rules().ignoreDrafts"
        (valueChange)="notifyRules.update({ ignoreDrafts: $event })"
      />

      <div class="ui-settings__fields">
        <app-field
          [label]="'settings.notify-min-likes' | translate"
          [hint]="'settings.notify-min-likes-hint' | translate"
        >
          <app-text-input
            [numeric]="true"
            [disabled]="byRules()"
            [value]="'' + rules().minLikes"
            (valueChange)="onMinLikesChange($event)"
          />
        </app-field>

        <app-field
          [label]="'settings.notify-muted-authors' | translate"
          [hint]="'settings.notify-muted-authors-hint' | translate"
        >
          <app-text-input
            [disabled]="byRules()"
            [value]="draftAuthors()"
            (valueChange)="onAuthorsChange($event)"
          />
        </app-field>
      </div>

      <h3 class="ui-settings__subtitle">{{ 'settings.notify-rules' | translate }}</h3>
      <p class="ui-settings__hint">{{ 'settings.notify-rules-summary' | translate }}</p>
      @if (!byRules()) {
        <app-alert tone="info" data-test="rules-off">
          {{ 'settings.notify-rules-off' | translate }}
        </app-alert>
      }
      <!-- Sem esta frase, a regra preenchida e desligada não dá sinal nenhum do porquê. -->
      <p class="ui-settings__hint">{{ 'settings.notify-rules-new-off' | translate }}</p>
      <app-rule-list
        [rules]="rules().rules"
        [context]="context()"
        [showMode]="true"
        [showKinds]="true"
        [emptyMessage]="'settings.notify-rules-empty' | translate"
        (ruleChange)="onRuleChange($event)"
        (ruleRemove)="notifyRules.removeRule($event)"
        (ruleAdd)="notifyRules.addRule()"
      />

      <h3 class="ui-settings__subtitle">{{ 'settings.notify-always' | translate }}</h3>
      <p class="ui-settings__hint">{{ 'settings.notify-always-summary' | translate }}</p>

      <div class="ui-settings__fields">
        <app-field
          [label]="'settings.notify-cooldown' | translate"
          [hint]="'settings.notify-cooldown-hint' | translate"
        >
          <app-text-input
            [numeric]="true"
            [value]="'' + rules().cooldownMinutes"
            (valueChange)="onCooldownChange($event)"
          />
        </app-field>
      </div>

      <app-checkbox
        [label]="'settings.notify-quiet-hours' | translate"
        [value]="rules().quietHours !== null"
        (valueChange)="onQuietToggle($event)"
      />
      @if (rules().quietHours) {
        <div class="ui-settings__fields">
          <app-field [label]="'settings.notify-quiet-from' | translate">
            <app-text-input
              type="time"
              [value]="draftStart()"
              (valueChange)="onQuietChange('start', $event)"
            />
          </app-field>
          <app-field [label]="'settings.notify-quiet-to' | translate">
            <app-text-input
              type="time"
              [value]="draftEnd()"
              (valueChange)="onQuietChange('end', $event)"
            />
          </app-field>
        </div>
      }

      <p class="ui-settings__hint">{{ 'settings.notify-discarded' | translate }}</p>
    </section>
  `,
})
export class NotificationsSectionComponent {
  private readonly notifyRules = inject(NotifyRulesService);
  private readonly notifications = inject(NotificationsService);
  private readonly monitor = inject(GitlabMonitorService);
  private readonly translate = inject(TranslateService);
  // O catálogo chega por HTTP depois da primeira renderização: sem esta
  // dependência, o rótulo do select ficaria preso ao que existia antes dele.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  protected readonly rules: Signal<NotifyRules> = this.notifyRules.rules;
  protected readonly notifyEnabled: Signal<boolean> = this.notifications.enabled;
  protected readonly notifyHintKey: Signal<string | null> = this.notifications.hint;
  protected readonly refreshing: Signal<boolean> = this.monitor.refreshing;

  protected readonly context: Signal<RuleListContext> = inject(RuleEditorService).context;

  /** Quem decide agora é a lista de critérios: o corte geral fica de lado. */
  protected readonly byRules: Signal<boolean> = computed(
    (): boolean => this.rules().decider === 'rules',
  );

  protected readonly deciderOptions: Signal<readonly { value: string; label: string }[]> = computed(
    (): readonly { value: string; label: string }[] => {
      this.language();
      return NOTIFY_DECIDERS.map((decider: NotifyDecider) => ({
        value: decider,
        label: String(this.translate.instant(`settings.notify-decider-${decider}`)),
      }));
    },
  );

  /** O corte geral guarda um sim/não por tipo; o multi-select fala em lista
   * de marcados. A conversão é aqui, e o que vai ao arquivo continua o mesmo. */
  protected readonly selectedKinds: Signal<readonly string[]> = computed((): readonly string[] => {
    const kinds = this.rules().kinds;
    return NOTIFY_EVENT_KINDS.filter((kind: PanelEventKind): boolean => kinds[kind]);
  });

  // Os campos de texto guardam o que está sendo digitado: reescrevê-los a
  // partir da regra já normalizada comeria a vírgula ou o ":" no meio da
  // edição. Partem do valor salvo e, depois, são de quem digita.
  protected readonly draftAuthors: WritableSignal<string> = linkedSignal<string, string>({
    source: (): string => this.rules().mutedAuthors.join(', '),
    computation: (source, previous): string => previous?.value ?? source,
  });
  protected readonly draftStart: WritableSignal<string> = linkedSignal<string, string>({
    source: (): string => this.rules().quietHours?.start ?? DEFAULT_QUIET.start,
    computation: (source, previous): string => previous?.value ?? source,
  });
  protected readonly draftEnd: WritableSignal<string> = linkedSignal<string, string>({
    source: (): string => this.rules().quietHours?.end ?? DEFAULT_QUIET.end,
    computation: (source, previous): string => previous?.value ?? source,
  });

  /** O select só oferece os dois valores da lista; o estreitamento é o que prova isso. */
  protected onDeciderChange(value: string): void {
    this.notifyRules.update({ decider: value === 'rules' ? 'rules' : 'general' });
  }

  protected onNotifyToggle(checked: boolean): void {
    void this.notifications.onToggle(checked);
  }

  protected onCheckNow(): void {
    void this.monitor.refreshNow();
  }

  protected onTestNotification(): void {
    void this.notifications.sendTest(
      this.translate.instant('notifications.test-title'),
      this.translate.instant('notifications.test-body'),
    );
  }

  /** Grava todos os tipos, e não só os marcados: o que some da lista fica
   * explicitamente desligado no arquivo, como era com as caixas. */
  protected onKindsChange(selected: readonly string[]): void {
    const kinds = { ...this.rules().kinds };
    for (const kind of NOTIFY_EVENT_KINDS) kinds[kind] = selected.includes(kind);
    this.notifyRules.update({ kinds });
  }

  protected onRuleChange(change: RuleChange): void {
    this.notifyRules.updateRule(change.id, notifyPatch(change.patch));
  }

  /** Vazio, negativo ou texto valem como zero: sem filtro. */
  protected onMinLikesChange(value: string): void {
    this.notifyRules.update({ minLikes: toCount(value) });
  }

  protected onCooldownChange(value: string): void {
    this.notifyRules.update({ cooldownMinutes: toCount(value) });
  }

  protected onAuthorsChange(value: string): void {
    this.draftAuthors.set(value);
    this.notifyRules.update({
      mutedAuthors: value
        .split(',')
        .map((author) => author.trim())
        .filter(Boolean),
    });
  }

  protected onQuietToggle(on: boolean): void {
    this.notifyRules.update({
      quietHours: on ? { start: this.draftStart(), end: this.draftEnd() } : null,
    });
  }

  protected onQuietChange(edge: 'start' | 'end', value: string): void {
    (edge === 'start' ? this.draftStart : this.draftEnd).set(value);
    // O campo de horário vazio (limpo à mão) não é uma janela: mantém a anterior.
    if (!value) return;
    const current = this.rules().quietHours ?? DEFAULT_QUIET;
    this.notifyRules.update({ quietHours: { ...current, [edge]: value } });
  }
}

/**
 * O que o editor emitiu, estreitado ao que uma regra de aviso tem. O editor
 * serve as duas telas, então o patch dele pode falar de `tone` e `markStyle`:
 * copiar campo a campo é o que impede os dois de entrarem no arquivo caso
 * alguém ligue `appearance` aqui um dia — um `as` aceitaria os dois calado.
 */
function notifyPatch(patch: Partial<EditableRule>): NotifyPatch {
  const next: NotifyPatch = {};
  if (patch.field !== undefined) next.field = patch.field;
  if (patch.operator !== undefined) next.operator = patch.operator;
  if (patch.value !== undefined) next.value = patch.value;
  if (patch.mode !== undefined) next.mode = patch.mode;
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  // O multi-select só oferece os seis tipos; o filtro é o que prova isso ao compilador.
  if (patch.kinds !== undefined) next.kinds = patch.kinds.filter(isEventKind);
  return next;
}

function isEventKind(value: string): value is PanelEventKind {
  return (NOTIFY_EVENT_KINDS as readonly string[]).includes(value);
}

function toCount(value: string): number {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}
