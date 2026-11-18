import { describe, expect, it } from 'vitest';

import { TableColumn } from './data-table.model';
import { nextSort, sortRows } from './table-sort';

interface Linha {
  readonly nome: string;
  readonly tokens: number | null;
  readonly rotulo: string;
}

const colunas: readonly TableColumn<Linha>[] = [
  { key: 'nome', header: 'Nome', sortable: true },
  {
    key: 'tokens',
    header: 'Tokens',
    align: 'end',
    sortable: true,
    value: (r: Linha): string => String(r.tokens),
  },
  {
    key: 'rotulo',
    header: 'Rótulo',
    sortable: true,
    sortValue: (r: Linha): number => r.rotulo.length,
  },
  { key: 'fixa', header: 'Fixa', sortable: true, sortLocked: true },
];

const linhas: readonly Linha[] = [
  { nome: 'beta', tokens: 10, rotulo: 'ccc' },
  { nome: 'Alfa', tokens: null, rotulo: 'a' },
  { nome: 'gama 2', tokens: 300, rotulo: 'bb' },
  { nome: 'gama 10', tokens: 2, rotulo: 'dddd' },
];

describe('sortRows', () => {
  it('sem ordenação devolve a ordem original', () => {
    expect(sortRows(linhas, colunas, null, 'pt')).toEqual(linhas);
  });

  it('texto em ordem alfabética sem diferenciar maiúscula e com números naturais', () => {
    const r = sortRows(linhas, colunas, { key: 'nome', direction: 'asc' }, 'pt');
    expect(r.map((l) => l.nome)).toEqual(['Alfa', 'beta', 'gama 2', 'gama 10']);
  });

  it('número pelo valor bruto, não pelo texto formatado; vazio sempre no fim', () => {
    const desc = sortRows(linhas, colunas, { key: 'tokens', direction: 'desc' }, 'pt');
    expect(desc.map((l) => l.tokens)).toEqual([300, 10, 2, null]);
    const asc = sortRows(linhas, colunas, { key: 'tokens', direction: 'asc' }, 'pt');
    expect(asc.map((l) => l.tokens)).toEqual([2, 10, 300, null]);
  });

  it('sortValue manda no valor comparado', () => {
    const r = sortRows(linhas, colunas, { key: 'rotulo', direction: 'asc' }, 'pt');
    expect(r.map((l) => l.rotulo)).toEqual(['a', 'bb', 'ccc', 'dddd']);
  });

  it('coluna desconhecida não reordena e não altera a lista recebida', () => {
    const copia = [...linhas];
    expect(sortRows(linhas, colunas, { key: 'nada', direction: 'asc' }, 'pt')).toEqual(linhas);
    sortRows(linhas, colunas, { key: 'nome', direction: 'asc' }, 'pt');
    expect(linhas).toEqual(copia);
  });
});

describe('nextSort', () => {
  it('número começa do maior; texto, do A', () => {
    expect(nextSort(null, colunas[1])).toEqual({ key: 'tokens', direction: 'desc' });
    expect(nextSort(null, colunas[0])).toEqual({ key: 'nome', direction: 'asc' });
  });

  it('segundo clique inverte; terceiro volta à ordem original', () => {
    const um = nextSort(null, colunas[0]);
    const dois = nextSort(um, colunas[0]);
    expect(dois).toEqual({ key: 'nome', direction: 'desc' });
    expect(nextSort(dois, colunas[0])).toBeNull();
  });

  it('trocar de coluna recomeça no sentido inicial dela', () => {
    expect(nextSort({ key: 'nome', direction: 'desc' }, colunas[1])).toEqual({
      key: 'tokens',
      direction: 'desc',
    });
  });

  it('coluna travada só seleciona no sentido inicial, sem inverter nem limpar', () => {
    const r = nextSort({ key: 'fixa', direction: 'asc' }, colunas[3]);
    expect(r).toEqual({ key: 'fixa', direction: 'asc' });
  });

  it('firstDirection troca o sentido inicial', () => {
    expect(
      nextSort(null, { key: 'x', header: 'X', sortable: true, firstDirection: 'desc' }),
    ).toEqual({ key: 'x', direction: 'desc' });
  });
});
