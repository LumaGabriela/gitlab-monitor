import { Provider, Signal, signal } from '@angular/core';
import {
  PreferenceKey,
  Preferences,
  PreferencesDocument,
} from '../app/core/models/api/preferences-api.model';
import { PreferencesStore, SaveStatus } from '../app/core/services/preferences-store.service';

/**
 * O PreferencesStore sem rede: `read` e `write` sobre um objeto comum. Quem
 * testa um serviço de preferência troca o store por este e confere, em
 * `writes`, a chave e o valor que o serviço gravou.
 */
export class FakePreferencesStore {
  public readonly data: Record<string, unknown>;
  public readonly writes: { key: PreferenceKey; value: unknown }[] = [];
  public readonly file: Signal<string | null> = signal<string | null>(
    'user-data/preferences.json',
  ).asReadonly();
  public readonly saveStatus: Signal<SaveStatus> = signal<SaveStatus>('idle').asReadonly();

  public constructor(initial: Preferences = {}) {
    this.data = { ...initial };
  }

  public read(key: PreferenceKey): unknown {
    return this.data[key];
  }

  public write(key: PreferenceKey, value: unknown): void {
    this.writes.push({ key, value });
    this.data[key] = value;
  }

  public snapshot(): PreferencesDocument {
    return { version: 1, preferences: { ...this.data } };
  }

  /** Por padrão resolve; o spec troca por `vi.fn()` quando precisa falhar ou espiar. */
  public replace(document: PreferencesDocument): Promise<void> {
    for (const key of Object.keys(this.data)) delete this.data[key];
    Object.assign(this.data, document.preferences);
    return Promise.resolve();
  }

  /** O último valor gravado para a chave, ou `undefined` se nunca foi gravada. */
  public lastWrite(key: PreferenceKey): unknown {
    return this.writes.filter((write) => write.key === key).at(-1)?.value;
  }
}

export function providePreferences(store: FakePreferencesStore): Provider {
  return { provide: PreferencesStore, useValue: store };
}
