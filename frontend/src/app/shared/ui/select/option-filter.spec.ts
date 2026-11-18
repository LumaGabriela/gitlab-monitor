import { filterOptions, normalizeTerm } from './option-filter';
import { SelectOption } from './select.model';

const OPCOES: readonly SelectOption[] = [
  { value: 'a', label: 'Revisão pendente' },
  { value: 'b', label: 'flake/siga/poc-sdd-frontend' },
  { value: 'c', label: 'flake/siga/poc-sdd-backend' },
];

describe('filterOptions', () => {
  it('termo em branco devolve a lista inteira', () => {
    expect(filterOptions(OPCOES, '')).toEqual(OPCOES);
    expect(filterOptions(OPCOES, '   ')).toEqual(OPCOES);
  });

  it('acha sem acento e sem caixa', () => {
    expect(filterOptions(OPCOES, 'revisao').map((o) => o.value)).toEqual(['a']);
    expect(filterOptions(OPCOES, 'REVISÃO').map((o) => o.value)).toEqual(['a']);
  });

  it('acha no meio do rótulo, não só no começo', () => {
    expect(filterOptions(OPCOES, 'frontend').map((o) => o.value)).toEqual(['b']);
    expect(filterOptions(OPCOES, 'poc-sdd').map((o) => o.value)).toEqual(['b', 'c']);
  });

  it('termo que não casa com nada devolve lista vazia', () => {
    expect(filterOptions(OPCOES, 'inexistente')).toEqual([]);
  });

  it('normaliza acento e caixa', () => {
    expect(normalizeTerm('Revisão Pendente')).toBe('revisao pendente');
  });
});
