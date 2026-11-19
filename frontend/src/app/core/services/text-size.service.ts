import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { PreferencesStore } from './preferences-store.service';

/** Tamanho do texto da interface. `md` é o do Design System. */
export type TextSize = 'sm' | 'md' | 'lg';

export const TEXT_SIZES: readonly TextSize[] = ['sm', 'md', 'lg'];

/**
 * Preferência de tamanho do texto. Troca a classe no <html>, e é
 * _themes.scss que redefine a escala inteira de uma vez: nenhum componente
 * sabe que a escala mudou, e nada fica fora de proporção.
 */
@Injectable({ providedIn: 'root' })
export class TextSizeService {
  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly selected: WritableSignal<TextSize> = signal<TextSize>(
    parseTextSize(this.store.read('textSize')),
  );
  public readonly size: Signal<TextSize> = this.selected.asReadonly();

  public constructor() {
    this.apply();
  }

  public setSize(size: TextSize): void {
    if (!TEXT_SIZES.includes(size)) return;
    this.selected.set(size);
    this.store.write('textSize', size);
    this.apply();
  }

  private apply(): void {
    const root = document.documentElement;
    root.classList.toggle('text-size-sm', this.selected() === 'sm');
    root.classList.toggle('text-size-lg', this.selected() === 'lg');
  }
}

function parseTextSize(value: unknown): TextSize {
  return value === 'sm' || value === 'md' || value === 'lg' ? value : 'md';
}
