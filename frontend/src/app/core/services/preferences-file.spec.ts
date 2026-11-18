import { PreferencesDocument } from '../models/api/preferences-api.model';
import { ImportError, exportFile, parseImport } from './preferences-file';

describe('preferences-file', () => {
  const doc: PreferencesDocument = {
    version: 1,
    preferences: { theme: 'dark', rowRules: [{ id: 'r1' }] },
  };
  const now = new Date(2026, 10, 17, 9, 30);

  it('nomeia o export com a data local', () => {
    expect(exportFile(doc, new Date(2026, 10, 17)).name).toBe(
      'gitlab-monitor-preferences-2026-11-17.json',
    );
  });

  it('o conteúdo traz app, version, exportedAt e preferences, com indentação de 2 espaços', () => {
    const { content } = exportFile(doc, now);
    const parsed = JSON.parse(content) as Record<string, unknown>;

    expect(parsed['app']).toBe('gitlab-monitor');
    expect(parsed['version']).toBe(1);
    expect(parsed['exportedAt']).toBe(now.toISOString());
    expect(parsed['preferences']).toEqual(doc.preferences);
    expect(content).toContain('\n  "app": "gitlab-monitor"');
  });

  it('lê de volta o que exportou', () => {
    expect(parseImport(exportFile(doc, now).content)).toEqual({ ok: true, document: doc });
  });

  it('aceita o preferences.json de user-data, sem app', () => {
    expect(parseImport('{"version":1,"preferences":{"theme":"dark"}}').ok).toBe(true);
  });

  it.each<[string, ImportError]>([
    ['{quebrado', 'not-json'],
    ['{"app":"outra","version":1,"preferences":{}}', 'not-gitlab-monitor'],
    ['{"version":2,"preferences":{}}', 'unsupported-version'],
    ['{"version":1}', 'no-preferences'],
    ['{"version":1,"preferences":[]}', 'no-preferences'],
    ['[]', 'no-preferences'],
    ['null', 'no-preferences'],
  ])('recusa %s com %s', (text, error) => {
    expect(parseImport(text)).toEqual({ ok: false, error });
  });
});
