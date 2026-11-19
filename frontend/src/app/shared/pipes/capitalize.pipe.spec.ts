import { CapitalizePipe } from './capitalize.pipe';

describe('CapitalizePipe', () => {
  const pipe = new CapitalizePipe();

  it('põe a primeira letra em maiúscula', () => {
    expect(pipe.transform('sem conflito')).toBe('Sem conflito');
    expect(pipe.transform('falhou')).toBe('Falhou');
  });

  it('não mexe no resto do texto', () => {
    // "1/2 resolvidas" e "mergeável" vêm prontos do backend; só a primeira
    // letra é decisão da etiqueta.
    expect(pipe.transform('1/2 resolvidas')).toBe('1/2 resolvidas');
    expect(pipe.transform('sem Pipeline')).toBe('Sem Pipeline');
  });

  it('texto que começa com número passa intacto', () => {
    expect(pipe.transform('2')).toBe('2');
  });

  it('vazio, nulo e indefinido viram texto vazio', () => {
    expect(pipe.transform('')).toBe('');
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});
