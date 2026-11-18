import { Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { sameColumnKeys } from './column-keys';
import { PreferencesStore } from './preferences-store.service';

/**
 * A ordem das colunas da tabela, lembrada entre sessões.
 *
 * O backend informa as colunas e a ordem padrão; aqui só mora a preferência de
 * quem olha. Coluna nova no backend entra no fim e chave que o backend não
 * informa mais é descartada, então uma ordem salva nunca esconde nem inventa
 * coluna.
 */
@Injectable({ providedIn: 'root' })
export class ColumnOrderService {
  private readonly store: PreferencesStore = inject(PreferencesStore);
  private readonly knownColumns: WritableSignal<readonly string[]> = signal<readonly string[]>([]);
  private readonly preferred: WritableSignal<readonly string[]> = signal<readonly string[]>(
    parseColumnKeys(this.store.read('columnOrder')),
  );

  public readonly order: Signal<readonly string[]> = computed((): readonly string[] => {
    const known = this.knownColumns();
    const chosen = this.preferred().filter((key) => known.includes(key));
    return [...chosen, ...known.filter((key) => !chosen.includes(key))];
  });

  public registerColumns(keys: readonly string[]): void {
    // A lista chega de novo a cada ciclo de consulta: sem esta saída, `order`
    // emitiria a cada dez segundos e acordaria presets, tabela e a própria
    // seção de colunas enquanto alguém a edita.
    if (sameColumnKeys(this.knownColumns(), keys)) return;
    // Antes da primeira resposta de /data, `keys` vem vazio. A preferência
    // salva não é podada: `order` já ignora o que o backend não informa.
    this.knownColumns.set(keys);
  }

  public move(key: string, delta: -1 | 1): void {
    const next = [...this.order()];
    const from = next.indexOf(key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to], next[from]];
    this.preferred.set(next);
    this.store.write('columnOrder', next);
  }

  public reset(): void {
    this.preferred.set([]);
    this.store.write('columnOrder', []);
  }

  /** Ordena pela posição escolhida; o que ainda não foi registrado vai ao fim. */
  public sort<T extends { key: string }>(columns: readonly T[]): readonly T[] {
    const order = this.order();
    const position = (key: string): number => {
      const index = order.indexOf(key);
      return index < 0 ? order.length : index;
    };
    return [...columns].sort((a, b) => position(a.key) - position(b.key));
  }
}

function parseColumnKeys(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
