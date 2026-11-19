/** As treze chaves que o backend aceita em user-data/preferences.json. */
export type PreferenceKey =
  | 'theme'
  | 'language'
  | 'textSize'
  | 'density'
  | 'hiddenColumns'
  | 'columnOrder'
  | 'likesHighlight'
  | 'filters'
  | 'rowRules'
  | 'notifyRules'
  | 'presets'
  | 'monitoredProjects'
  | 'interval';

/** O conteúdo de cada chave é validado por quem o usa, não pelo store. */
export type Preferences = Partial<Readonly<Record<PreferenceKey, unknown>>>;

export interface PreferencesDocument {
  readonly version: 1;
  readonly preferences: Preferences;
}

export interface PreferencesResponse extends PreferencesDocument {
  readonly file: string;
}

/** Teto do documento no POST e no import, igual ao do backend. */
export const PREFERENCES_MAX_BYTES = 262144;
