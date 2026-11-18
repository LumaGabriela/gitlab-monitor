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
  Preset,
  PresetsService,
  isBuiltInPreset,
} from '../../../core/services/presets.service';
import { presetLabel } from '../../../shared/monitor/preset-label';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';
import { FieldComponent } from '../../../shared/ui/field/field.component';
import { TextInputComponent } from '../../../shared/ui/text-input/text-input.component';

/** Pausa entre apagar e repor o aviso: sem ela o texto não muda e o leitor de tela não repete. */
const REANNOUNCE_MS = 100;
/** Quanto o aviso fica na tela antes de sumir. */
const SAVED_VISIBLE_MS = 3000;

interface PresetItem {
  readonly id: string;
  readonly label: string;
  readonly builtIn: boolean;
}

/**
 * Presets: pacotes nomeados de preferências, aplicados num clique. Preferência
 * local, sem botão Salvar de seção: salvar o atual é a própria ação, e o
 * resultado é anunciado em `role="status"`.
 */
@Component({
  selector: 'app-presets-section',
  imports: [ButtonDirective, FieldComponent, TextInputComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-settings-section" id="predefinicoes">
      <h2 class="ui-settings-section__title" data-focus-target tabindex="-1">
        {{ 'settings.presets' | translate }}
      </h2>
      <p class="ui-settings__hint">{{ 'settings.presets-summary' | translate }}</p>

      <ul class="ui-settings__presets">
        @for (item of items(); track item.id) {
          <li class="ui-settings__preset" [attr.data-preset]="item.id">
            @if (item.builtIn) {
              <div class="ui-settings__preset-name">
                <span class="ui-settings__preset-label">{{ item.label }}</span>
                <span class="ui-settings__hint">{{ 'settings.preset-builtin-hint' | translate }}</span>
              </div>
            } @else {
              <app-field class="ui-settings__preset-name" [label]="'settings.preset-rename' | translate">
                <app-text-input
                  data-test="preset-rename"
                  [value]="item.label"
                  (valueChange)="presets.rename(item.id, $event)"
                />
              </app-field>
            }
            <div class="ui-settings__actions">
              <button
                type="button"
                appButton
                variant="outline"
                data-test="preset-apply"
                [attr.aria-label]="'settings.preset-apply-named' | translate: { name: item.label }"
                (click)="presets.apply(item.id)"
              >
                {{ 'settings.preset-apply' | translate }}
              </button>
              @if (!item.builtIn) {
                <button
                  type="button"
                  appButton
                  variant="ghost"
                  data-test="preset-remove"
                  [attr.aria-label]="'settings.preset-remove-named' | translate: { name: item.label }"
                  (click)="presets.remove(item.id)"
                >
                  {{ 'settings.preset-remove' | translate }}
                </button>
              }
            </div>
          </li>
        }
      </ul>

      <div class="ui-settings__preset-save">
        <app-field class="ui-settings__preset-name" [label]="'settings.preset-name' | translate">
          <app-text-input
            data-test="preset-name"
            [value]="draft()"
            (valueChange)="draft.set($event)"
          />
        </app-field>
        <button
          type="button"
          appButton
          variant="outline"
          data-test="preset-save"
          [disabled]="!draft().trim()"
          (click)="save()"
        >
          {{ 'settings.preset-save-current' | translate }}
        </button>
      </div>

      <!-- Sempre no DOM: uma região viva só anuncia o que muda dentro dela. -->
      <p class="ui-settings__saved" role="status" aria-live="polite">
        @if (saved()) {
          {{ 'settings.preset-saved' | translate }}
        }
      </p>
    </section>
  `,
})
export class PresetsSectionComponent {
  protected readonly presets = inject(PresetsService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef: DestroyRef = inject(DestroyRef);
  private timers: ReturnType<typeof setTimeout>[] = [];
  // O catálogo chega por HTTP depois da primeira renderização: sem esta
  // dependência, o nome dos prontos ficaria preso à chave crua.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  protected readonly draft: WritableSignal<string> = signal<string>('');
  protected readonly saved: WritableSignal<boolean> = signal<boolean>(false);

  protected readonly items: Signal<readonly PresetItem[]> = computed((): readonly PresetItem[] => {
    this.language();
    return this.presets.presets().map((preset: Preset): PresetItem => ({
      id: preset.id,
      label: presetLabel(this.translate, preset),
      builtIn: isBuiltInPreset(preset.id),
    }));
  });

  public constructor() {
    this.destroyRef.onDestroy((): void => this.clearTimers());
  }

  protected save(): void {
    this.presets.saveCurrent(this.draft());
    this.draft.set('');
    this.announceSaved();
  }

  /** Uma região viva só anuncia o que MUDA: o aviso some e volta a cada salvamento. */
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
