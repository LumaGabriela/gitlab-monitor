import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const root = (): HTMLElement => document.documentElement;
  const create = (store: FakePreferencesStore = new FakePreferencesStore()): ThemeService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [providePreferences(store)] });
    return TestBed.inject(ThemeService);
  };

  beforeEach(() => root().classList.remove('dark'));
  afterEach(() => {
    root().classList.remove('dark');
    delete root().dataset['themeChoice'];
  });

  it('sem escolha salva, começa em automático', () => {
    expect(create().choice()).toBe('auto');
  });

  it('escolher escuro põe a classe que a folha de estilo espera', () => {
    // É `.dark` no <html> que _themes.scss usa para trocar os valores.
    create().setChoice('dark');

    expect(root().classList).toContain('dark');
  });

  it('grava a escolha no store', () => {
    const store = new FakePreferencesStore();
    create(store).setChoice('dark');

    expect(store.writes).toEqual([{ key: 'theme', value: 'dark' }]);
  });

  it('lê a escolha guardada e já a aplica ao <html>', () => {
    const service = create(new FakePreferencesStore({ theme: 'dark' }));

    expect(service.choice()).toBe('dark');
    expect(root().classList).toContain('dark');
    expect(root().dataset['themeChoice']).toBe('dark');
  });

  it.each([['{quebrado'], [42], [null], ['roxo']])(
    'valor de tipo errado no store (%j) cai em automático',
    (value) => {
      expect(create(new FakePreferencesStore({ theme: value })).choice()).toBe('auto');
    },
  );

  it('escolher claro tira a classe, mesmo com o sistema no escuro', () => {
    const service = create();
    service.setChoice('dark');
    service.setChoice('light');

    expect(root().classList).not.toContain('dark');
  });

  it('a escolha crua fica registrada à parte, porque "auto" não se deduz da classe', () => {
    create().setChoice('auto');

    expect(root().dataset['themeChoice']).toBe('auto');
  });
});
