import { Preferences, PreferencesDocument } from '../models/api/preferences-api.model';

export type ImportError =
  | 'too-large'
  | 'not-json'
  | 'not-gitlab-monitor'
  | 'unsupported-version'
  | 'no-preferences';

export type ImportResult =
  | { readonly ok: true; readonly document: PreferencesDocument }
  | { readonly ok: false; readonly error: ImportError };

const APP_NAME = 'gitlab-monitor';

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/** O arquivo de export: o documento das preferências com a identificação do app. */
export function exportFile(
  document: PreferencesDocument,
  now: Date,
): { readonly name: string; readonly content: string } {
  const day = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  const content = JSON.stringify(
    {
      app: APP_NAME,
      version: document.version,
      exportedAt: now.toISOString(),
      preferences: document.preferences,
    },
    null,
    2,
  );
  return { name: `gitlab-monitor-preferences-${day}.json`, content };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Valida só a casca do arquivo. Aceita o export e o próprio
 * user-data/preferences.json (sem `app`); o conteúdo de cada chave é validado
 * por quem a usa, depois de recarregar.
 */
export function parseImport(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (!isRecord(raw)) return { ok: false, error: 'no-preferences' };
  if ('app' in raw && raw['app'] !== APP_NAME) return { ok: false, error: 'not-gitlab-monitor' };
  if (raw['version'] !== 1) return { ok: false, error: 'unsupported-version' };
  const preferences = raw['preferences'];
  if (!isRecord(preferences)) return { ok: false, error: 'no-preferences' };
  return { ok: true, document: { version: 1, preferences: preferences as Preferences } };
}
