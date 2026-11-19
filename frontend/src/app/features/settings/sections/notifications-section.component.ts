import {
  ChangeDetectionStrategy,
  Component,
  Signal,
  WritableSignal,
  inject,
  linkedSignal,
} from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { PanelEventKind } from '../../../core/models/api/panel-api.model';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { NotificationsService } from '../../../core/services/notifications.service';
import {
  NOTIFY_EVENT_KINDS,
  NotifyRules,
  NotifyRulesService,
} from '../../../core/services/notify-rules.service';
import { CardComponent } from '../../../shared/ui/card/card.component';
import { AlertComponent } from '../../../shared/ui/alert/alert.component';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';
import { CheckboxComponent } from '../../../shared/ui/checkbox/checkbox.component';
import { FieldComponent } from '../../../shared/ui/field/field.component';
import { TextInputComponent } from '../../../shared/ui/text-input/text-input.component';

/** A janela que o horário silencioso assume ao ser ligado: a noite de trabalho. */
const DEFAULT_QUIET = { start: '19:00', end: '09:00' } as const;

/**
 * O que merece aviso no navegador, mais o interruptor geral e as ações de
 * teste e verificação. Preferência local: vale na hora, sem botão Salvar.
 */
@Component({
  selector: 'app-notifications-section',
  imports: [
    CardComponent,
    AlertComponent,
    ButtonDirective,
    CheckboxComponent,
    FieldComponent,
    TextInputComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card>
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
            variant="ghost"
            [disabled]="refreshing()"
            (click)="onTestNotification()"
          >
            {{ 'settings.test-notification' | translate }}
          </button>
          <button
            type="button"
            appButton
            variant="ghost"
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

        <p class="ui-settings__hint">{{ 'settings.notify-kinds-hint' | translate }}</p>
        <div class="ui-settings__kinds">
          @for (kind of kinds; track kind) {
            <app-checkbox
              [label]="'settings.notify-kind-' + kind | translate"
              [value]="rules().kinds[kind]"
              (valueChange)="onKindChange(kind, $event)"
            />
          }
        </div>

        <app-checkbox
          [label]="'settings.notify-only-mine' | translate"
          [value]="rules().onlyMine"
          (valueChange)="notifyRules.update({ onlyMine: $event })"
        />
        <app-checkbox
          [label]="'settings.notify-ignore-drafts' | translate"
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
              [value]="'' + rules().minLikes"
              (valueChange)="onMinLikesChange($event)"
            />
          </app-field>

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

          <app-field
            [label]="'settings.notify-muted-authors' | translate"
            [hint]="'settings.notify-muted-authors-hint' | translate"
          >
            <app-text-input [value]="draftAuthors()" (valueChange)="onAuthorsChange($event)" />
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
    </app-card>
  `,
})
export class NotificationsSectionComponent {
  private readonly notifyRules = inject(NotifyRulesService);
  private readonly notifications = inject(NotificationsService);
  private readonly monitor = inject(GitlabMonitorService);
  private readonly translate = inject(TranslateService);

  protected readonly rules: Signal<NotifyRules> = this.notifyRules.rules;
  protected readonly notifyEnabled: Signal<boolean> = this.notifications.enabled;
  protected readonly notifyHintKey: Signal<string | null> = this.notifications.hint;
  protected readonly refreshing: Signal<boolean> = this.monitor.refreshing;

  protected readonly kinds: readonly PanelEventKind[] = NOTIFY_EVENT_KINDS;

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

  protected onKindChange(kind: PanelEventKind, checked: boolean): void {
    this.notifyRules.update({ kinds: { ...this.rules().kinds, [kind]: checked } });
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

function toCount(value: string): number {
  const count = Number.parseInt(value, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}
