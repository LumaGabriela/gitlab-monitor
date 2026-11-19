import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { PreferencesStore } from './preferences-store.service';

/** O que a pessoa escolheu. `auto` segue o sistema. */
export type ThemeChoice = 'auto' | 'light' | 'dark';
/** O que está valendo na tela agora. */
export type ThemeMode = 'light' | 'dark';

/**
 * Tema claro/escuro. O index.html já aplicou a classe antes da primeira
 * pintura (mesmo algoritmo, inline, para não esperar o Angular subir); aqui
 * só lemos o resultado e reagimos à troca.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  // matchMedia pode faltar em ambiente de teste; sem ele o tema automático
  // assume claro, em vez de quebrar a injeção.
  private readonly media: MediaQueryList | null =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly selected: WritableSignal<ThemeChoice> = signal<ThemeChoice>(
    parseThemeChoice(this.store.read('theme')),
  );
  private readonly systemDark: WritableSignal<boolean> = signal<boolean>(
    this.media?.matches ?? false,
  );

  public readonly choice: Signal<ThemeChoice> = this.selected.asReadonly();

  /** O tema que está na tela, já resolvido: é o que o botão de alternar usa
   * para saber para onde ir. */
  public readonly currentTheme: Signal<ThemeMode> = computed((): ThemeMode => {
    const choice = this.selected();
    if (choice !== 'auto') return choice;
    return this.systemDark() ? 'dark' : 'light';
  });

  public constructor() {
    this.media?.addEventListener('change', (event: MediaQueryListEvent): void => {
      this.systemDark.set(event.matches);
      this.apply();
    });
    this.apply();
  }

  public setChoice(choice: ThemeChoice): void {
    this.selected.set(choice);
    this.store.write('theme', choice);
    this.apply();
  }

  /**
   * Alterna entre claro e escuro. Partindo de `auto`, vai para o oposto do
   * que está na tela — e deixa de seguir o sistema, que é o que quem clicou
   * acabou de pedir.
   */
  public toggleTheme(): void {
    this.setChoice(this.currentTheme() === 'dark' ? 'light' : 'dark');
  }

  // A classe `.dark` no <html> é o que _themes.scss espera; o data-attribute
  // guarda a escolha crua, que "auto" não deixa deduzir da classe.
  private apply(): void {
    const root = document.documentElement;
    root.classList.toggle('dark', this.currentTheme() === 'dark');
    root.dataset['themeChoice'] = this.selected();
  }
}

function parseThemeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
}
