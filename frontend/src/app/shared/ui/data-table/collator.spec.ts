import { collatorFor } from './collator';

describe('collatorFor', () => {
  it('ordena com a colação do idioma ativo', () => {
    expect(collatorFor('pt').compare('ótimo', 'otimo')).toBe(0);
  });

  it('memoiza um colador por idioma', () => {
    expect(collatorFor('pt')).toBe(collatorFor('pt'));
    expect(collatorFor('pt')).not.toBe(collatorFor('en'));
  });
});
