import { formatDate, formatRelative, formatTime } from './cell-format';

describe('cell-format', () => {
  it('formata o tempo relativo no idioma ativo', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const tresDias = '2026-11-14T12:00:00Z';
    expect(formatRelative(tresDias, 'pt', now)).toBe('há 3 dias');
    expect(formatRelative(tresDias, 'en', now)).toBe('3 days ago');
  });

  it('usa a unidade mais larga que caiba na diferença', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    expect(formatRelative('2026-11-17T09:00:00Z', 'en', now)).toBe('3 hours ago');
    expect(formatRelative('2026-11-17T11:37:00Z', 'en', now)).toBe('23 minutes ago');
    expect(formatRelative('2026-09-17T12:00:00Z', 'en', now)).toBe('2 months ago');
    expect(formatRelative('2024-11-17T12:00:00Z', 'en', now)).toBe('2 years ago');
  });

  it('abaixo de um minuto devolve a chave do catálogo, para quem chama traduzir', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    expect(formatRelative('2026-11-17T11:59:30Z', 'pt', now)).toBe('monitor.just-now');
  });

  it('formata a data absoluta no idioma ativo', () => {
    expect(formatDate('2026-11-17T12:00:00Z', 'pt')).toBe('17/11/2026');
    expect(formatDate('2026-11-17T12:00:00Z', 'en')).toBe('11/17/2026');
  });

  it('formata a hora no idioma ativo', () => {
    expect(formatTime('2026-11-17T12:00:00Z', 'pt')).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(formatTime('não é data', 'pt')).toBe('');
  });

  it('devolve string vazia para ISO ausente ou ilegível', () => {
    expect(formatRelative('', 'pt')).toBe('');
    expect(formatDate('não é data', 'en')).toBe('');
  });
});
