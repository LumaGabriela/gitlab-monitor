import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { PreferencesStore } from './preferences-store.service';

/** Os idiomas que têm catálogo em src/assets/i18n/. */
export type SupportedLanguage = 'pt' | 'en';

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ['pt', 'en'];

const DEFAULT_LANGUAGE: SupportedLanguage = 'pt';

/** Idioma da interface, lembrado entre sessões. */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate: TranslateService = inject(TranslateService);
  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly current: WritableSignal<SupportedLanguage> =
    signal<SupportedLanguage>(initialLanguage());

  public readonly currentLang: Signal<SupportedLanguage> = this.current.asReadonly();

  public setLanguage(language: SupportedLanguage): void {
    if (!SUPPORTED_LANGUAGES.includes(language)) return;
    this.current.set(language);
    this.store.write('language', language);
    this.translate.use(language);
  }

  /**
   * Aplica o idioma guardado na abertura da página. Relê o store porque o
   * serviço pode ter sido construído antes de as preferências chegarem.
   */
  public restore(): void {
    const stored = this.store.read('language');
    if (stored === 'pt' || stored === 'en') this.current.set(stored);
    this.translate.use(this.current());
  }
}

/**
 * Idioma da primeira pintura: o Python o escreve em `data-language` no <html>.
 * Sob `ng serve` o atributo não existe e vale o padrão até as preferências
 * chegarem.
 */
export function initialLanguage(): SupportedLanguage {
  const value = document.documentElement.getAttribute('data-language');
  return value === 'pt' || value === 'en' ? value : DEFAULT_LANGUAGE;
}
