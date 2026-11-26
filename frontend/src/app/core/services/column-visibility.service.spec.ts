import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { ColumnVisibilityService } from './column-visibility.service';

describe('ColumnVisibilityService', () => {
  let store = new FakePreferencesStore();
  const create = (): ColumnVisibilityService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [providePreferences(store)] });
    return TestBed.inject(ColumnVisibilityService);
  };

  beforeEach(() => {
    store = new FakePreferencesStore();
  });

  it('esconder uma coluna fica guardado entre sessões', () => {
    create().setHidden('author', true);

    expect(create().isHidden('author')).toBe(true);
  });

  it('grava a escolha no store', () => {
    create().setHidden('author', true);

    expect(store.writes).toEqual([{ key: 'hiddenColumns', value: ['author'] }]);
  });

  it.each([['{quebrado'], [42], [null], [{ a: 1 }]])(
    'valor de tipo errado no store (%j) cai no padrão',
    (value) => {
      store = new FakePreferencesStore({ hiddenColumns: value });

      expect(create().hidden()).toEqual([]);
    },
  );

  it('item que não é texto é descartado da lista guardada', () => {
    store = new FakePreferencesStore({ hiddenColumns: ['author', 3, null] });

    expect(create().hidden()).toEqual(['author']);
  });

  it('mostrar de volta remove a coluna da lista', () => {
    const service = create();
    service.setHidden('author', true);
    service.setHidden('author', false);

    expect(service.hidden()).toEqual([]);
  });

  it('esquece colunas que o backend não oferece mais', () => {
    store = new FakePreferencesStore({ hiddenColumns: ['author', 'coluna_extinta'] });
    const service = create();
    service.registerColumns(['mr', 'author']);

    expect(service.hidden()).toEqual(['author']);
  });

  it('antes da primeira resposta, a preferência salva é preservada', () => {
    // Podar contra uma lista vazia apagaria a escolha do usuário logo na
    // abertura da página, antes de o backend dizer quais colunas existem.
    store = new FakePreferencesStore({ hiddenColumns: ['author'] });
    const service = create();
    service.registerColumns([]);

    expect(service.hidden()).toEqual(['author']);
  });

  it('o que sobra visível segue a ordem das colunas do backend', () => {
    const service = create();
    service.setHidden('author', true);
    service.registerColumns(['mr', 'author', 'pipeline']);

    expect(service.visible()).toEqual(['mr', 'pipeline']);
  });
});
