import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { sameColumnKeys } from './column-keys';
import { PreferencesStore } from './preferences-store.service';

/** Quais colunas da tabela ficam escondidas, lembrado entre sessões. */
@Injectable({ providedIn: 'root' })
export class ColumnVisibilityService {
  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly knownColumns: WritableSignal<readonly string[]> = signal<readonly string[]>([]);
  private readonly hiddenColumns: WritableSignal<readonly string[]> = signal<readonly string[]>(
    parseColumnKeys(this.store.read('hiddenColumns')),
  );

  public readonly hidden: Signal<readonly string[]> = this.hiddenColumns.asReadonly();
  public readonly visible: Signal<readonly string[]> = computed((): readonly string[] =>
    this.knownColumns().filter((key) => !this.hiddenColumns().includes(key)),
  );

  public registerColumns(keys: readonly string[]): void {
    // Mesma lista, mesmo estado: escrever o sinal com o array novo de cada
    // ciclo faria `visible` emitir a cada dez segundos à toa.
    if (sameColumnKeys(this.knownColumns(), keys)) return;
    this.knownColumns.set(keys);
    // Antes da primeira resposta de /data, `keys` vem vazio: podar as
    // ocultas contra uma lista vazia apagaria a preferência salva antes
    // mesmo de o backend responder.
    if (!keys.length) return;
    const hidden = this.hiddenColumns().filter((key) => keys.includes(key));
    if (hidden.length !== this.hiddenColumns().length) {
      this.hiddenColumns.set(hidden);
    }
  }

  public isHidden(key: string): boolean {
    return this.hiddenColumns().includes(key);
  }

  public setHidden(key: string, hide: boolean): void {
    const current = this.hiddenColumns();
    const next = hide
      ? current.includes(key)
        ? current
        : [...current, key]
      : current.filter((item) => item !== key);
    this.hiddenColumns.set(next);
    this.store.write('hiddenColumns', next);
  }
}

function parseColumnKeys(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
