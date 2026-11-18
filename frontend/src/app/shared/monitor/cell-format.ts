/**
 * Formatos de data, hora e ordenação no idioma ativo. Funções puras: quem
 * chama decide o que mostrar quando o ISO falta (a string vazia).
 */

/** Chave do catálogo devolvida abaixo de um minuto; o texto é de quem traduz. */
export const JUST_NOW_KEY = 'monitor.just-now';

// Mesma granularidade do RELATIVE_UNITS do gitlab_monitor.py, da mais larga
// para a mais estreita: a primeira que caiba na diferença decide a unidade.
const RELATIVE_UNITS: readonly (readonly [number, Intl.RelativeTimeFormatUnit])[] = [
  [365 * 86400, 'year'],
  [30 * 86400, 'month'],
  [86400, 'day'],
  [3600, 'hour'],
  [60, 'minute'],
];

// Um formatador por idioma, como o collatorFor do app-data-table: estas
// funções rodam do template, para cada célula de tempo e a cada detecção de
// mudança, e construir um Intl a cada chamada é caro à toa.
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function cached<T>(cache: Map<string, T>, lang: string, build: () => T): T {
  let formatter = cache.get(lang);
  if (!formatter) {
    formatter = build();
    cache.set(lang, formatter);
  }
  return formatter;
}

function parse(iso: string): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "há 3 dias" / "3 days ago"; abaixo de um minuto, a chave `monitor.just-now`. */
export function formatRelative(iso: string, lang: string, now: Date = new Date()): string {
  const moment = parse(iso);
  if (!moment) return '';
  const seconds = (now.getTime() - moment.getTime()) / 1000;
  if (seconds < 60) return JUST_NOW_KEY;
  const formatter = cached(
    relativeFormatters,
    lang,
    () => new Intl.RelativeTimeFormat(lang, { numeric: 'always' }),
  );
  for (const [duration, unit] of RELATIVE_UNITS) {
    const amount = Math.floor(seconds / duration);
    if (amount >= 1) return formatter.format(-amount, unit);
  }
  return JUST_NOW_KEY;
}

// `dateStyle: 'short'` daria "11/17/26" em inglês; o ano de quatro dígitos
// mantém o que o painel mostrava ("17/11/2026") nos dois idiomas.
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

/** Data numérica no idioma ativo, com o ano inteiro. */
export function formatDate(iso: string, lang: string): string {
  const moment = parse(iso);
  if (!moment) return '';
  return cached(dateFormatters, lang, () => new Intl.DateTimeFormat(lang, DATE_FORMAT)).format(
    moment,
  );
}

/** Hora com segundos no idioma ativo. */
export function formatTime(iso: string, lang: string): string {
  const moment = parse(iso);
  if (!moment) return '';
  return cached(
    timeFormatters,
    lang,
    () => new Intl.DateTimeFormat(lang, { timeStyle: 'medium' }),
  ).format(moment);
}
