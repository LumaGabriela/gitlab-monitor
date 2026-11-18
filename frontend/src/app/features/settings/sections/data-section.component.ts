import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  Signal,
  WritableSignal,
  inject,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import {
  PREFERENCES_MAX_BYTES,
  PreferencesDocument,
} from '../../../core/models/api/preferences-api.model';
import {
  ImportError,
  exportFile,
  parseImport,
} from '../../../core/services/preferences-file';
import { PreferencesStore } from '../../../core/services/preferences-store.service';
import { AlertComponent } from '../../../shared/ui/alert/alert.component';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';
import { FilePickerComponent } from '../../../shared/ui/file-picker/file-picker.component';

/** Recarrega a página depois de importar; os specs trocam por um espião. */
export const PAGE_RELOAD: InjectionToken<() => void> = new InjectionToken<() => void>(
  'PAGE_RELOAD',
  {
    providedIn: 'root',
    factory: (): (() => void) => {
      const document: Document = inject(DOCUMENT);
      return (): void => document.location.reload();
    },
  },
);

interface ImportSummary {
  readonly document: PreferencesDocument;
  readonly rowRules: number;
  readonly notifyRules: number;
  readonly presets: number;
}

/** O arquivo importado só tem a casca validada: valor que não é lista conta zero. */
function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Dados: onde as preferências ficam, exportar para um arquivo e importar de
 * volta. Importar substitui tudo e recarrega a página, para que cada serviço
 * releia o documento novo.
 */
@Component({
  selector: 'app-data-section',
  imports: [AlertComponent, ButtonDirective, FilePickerComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-settings-section" id="dados">
      <h2 class="ui-settings-section__title" data-focus-target tabindex="-1">
        {{ 'settings.data' | translate }}
      </h2>
      <p class="ui-settings__hint">{{ 'settings.data-summary' | translate }}</p>

      <p class="ui-settings__hint" data-test="data-location">
        @if (file(); as path) {
          {{ 'preferences.file-location' | translate: { file: path } }}
        } @else {
          {{ 'preferences.file-unknown' | translate }}
        }
      </p>

      <div class="ui-settings-data__block">
        <h3 class="ui-settings-data__title">{{ 'settings.data-export' | translate }}</h3>
        <p class="ui-settings__hint">{{ 'settings.data-export-hint' | translate }}</p>
        <div class="ui-settings__actions ui-settings__actions--start">
          <button
            type="button"
            appButton
            variant="outline"
            data-test="data-export"
            [disabled]="file() === null"
            (click)="export()"
          >
            {{ 'settings.data-export-button' | translate }}
          </button>
        </div>
        @if (file() === null) {
          <app-alert tone="warning" data-test="data-export-unavailable">{{
            'settings.data-export-unavailable' | translate
          }}</app-alert>
        }
      </div>

      <div class="ui-settings-data__block">
        <h3 class="ui-settings-data__title">{{ 'settings.data-import' | translate }}</h3>
        <p class="ui-settings__hint">{{ 'settings.data-import-hint' | translate }}</p>
        <div class="ui-settings__actions ui-settings__actions--start">
          <app-file-picker
            [label]="'settings.data-import-button' | translate"
            accept="application/json,.json"
            [disabled]="replacing()"
            (fileSelected)="onFile($event)"
          />
        </div>
      </div>

      <!-- Sempre no DOM: uma região viva só anuncia o que muda dentro dela. -->
      <div class="ui-settings-data__result" role="status" data-test="data-result">
        @if (error(); as key) {
          <app-alert tone="danger">{{ key | translate }}</app-alert>
        }
        @if (pending(); as summary) {
          <app-alert tone="warning">
            <div class="ui-settings-data__confirm" data-test="import-summary">
              <p class="ui-settings-data__summary">
                {{
                  'settings.data-import-summary'
                    | translate
                      : {
                          rowRules: summary.rowRules,
                          notifyRules: summary.notifyRules,
                          presets: summary.presets,
                        }
                }}
              </p>
              <p class="ui-settings-data__summary">
                {{ 'settings.data-import-replaces' | translate }}
              </p>
              <div class="ui-settings__actions ui-settings__actions--start">
                <button
                  type="button"
                  appButton
                  variant="danger"
                  data-test="import-confirm"
                  [loading]="replacing()"
                  (click)="confirm(summary)"
                >
                  {{ 'settings.data-import-confirm' | translate }}
                </button>
                <button
                  type="button"
                  appButton
                  variant="outline"
                  data-test="import-cancel"
                  [disabled]="replacing()"
                  (click)="cancel()"
                >
                  {{ 'settings.data-import-cancel' | translate }}
                </button>
              </div>
            </div>
          </app-alert>
        }
      </div>
    </section>
  `,
})
export class DataSectionComponent {
  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly reload: () => void = inject(PAGE_RELOAD);
  private readonly document: Document = inject(DOCUMENT);

  protected readonly file: Signal<string | null> = this.store.file;
  protected readonly pending: WritableSignal<ImportSummary | null> = signal<ImportSummary | null>(
    null,
  );
  protected readonly error: WritableSignal<string | null> = signal<string | null>(null);
  protected readonly replacing: WritableSignal<boolean> = signal<boolean>(false);

  protected export(): void {
    const { name, content } = exportFile(this.store.snapshot(), new Date());
    const url: string = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link: HTMLAnchorElement = this.document.createElement('a');
    link.href = url;
    link.download = name;
    this.document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  protected async onFile(file: File): Promise<void> {
    this.pending.set(null);
    this.error.set(null);
    // O teto vale antes de ler: um arquivo enorme não deve ir para a memória.
    if (file.size > PREFERENCES_MAX_BYTES) {
      this.fail('too-large');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.fail('not-json');
      return;
    }
    const result = parseImport(text);
    if (!result.ok) {
      this.fail(result.error);
      return;
    }
    const preferences = result.document.preferences;
    this.pending.set({
      document: result.document,
      rowRules: count(preferences.rowRules),
      notifyRules: count(preferences.notifyRules),
      presets: count(preferences.presets),
    });
  }

  protected cancel(): void {
    this.pending.set(null);
  }

  protected async confirm(summary: ImportSummary): Promise<void> {
    this.replacing.set(true);
    this.error.set(null);
    try {
      await this.store.replace(summary.document);
    } catch {
      this.replacing.set(false);
      this.pending.set(null);
      this.error.set('preferences.import-failed');
      return;
    }
    this.reload();
  }

  private fail(error: ImportError): void {
    this.error.set(`preferences.import-error-${error}`);
  }
}
