import { Injectable, Signal, WritableSignal, inject, signal } from '@angular/core';
import { PreferencesStore } from './preferences-store.service';

/** Densidade da interface. `comfortable` é a do Design System. */
export type Density = 'comfortable' | 'compact';

export const DENSITIES: readonly Density[] = ['comfortable', 'compact'];

/**
 * Preferência de densidade. Troca a classe no <html>, e é _themes.scss que
 * redefine a escala de espaçamento inteira: nenhum componente sabe que a
 * escala mudou. O alvo mínimo de toque (--size-touch-min) fica fora dela.
 *
 * O padrão é confortável: espaçamento reduzido prejudica a leitura em baixa
 * visão e aproxima os alvos de toque, então compacto é opcional.
 */
@Injectable({ providedIn: 'root' })
export class DensityService {
  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly selected: WritableSignal<Density> = signal<Density>(
    parseDensity(this.store.read('density')),
  );
  public readonly density: Signal<Density> = this.selected.asReadonly();

  public constructor() {
    this.apply();
  }

  public setDensity(density: Density): void {
    if (!DENSITIES.includes(density)) return;
    this.selected.set(density);
    this.store.write('density', density);
    this.apply();
  }

  private apply(): void {
    document.documentElement.classList.toggle('density-compact', this.selected() === 'compact');
  }
}

function parseDensity(value: unknown): Density {
  return value === 'comfortable' || value === 'compact' ? value : 'comfortable';
}
