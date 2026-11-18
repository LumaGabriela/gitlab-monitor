import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { TextSizeService } from './text-size.service';

describe('TextSizeService', () => {
  const root = (): HTMLElement => document.documentElement;
  const create = (store: FakePreferencesStore = new FakePreferencesStore()): TextSizeService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [providePreferences(store)] });
    return TestBed.inject(TextSizeService);
  };

  beforeEach(() => root().classList.remove('text-size-sm', 'text-size-lg'));
  afterEach(() => root().classList.remove('text-size-sm', 'text-size-lg'));

  it('o padrão é o tamanho do Design System, sem classe nenhuma', () => {
    expect(create().size()).toBe('md');
    expect(root().className).not.toContain('text-size');
  });

  it('escolher um tamanho põe a classe que troca a escala inteira', () => {
    // É _themes.scss que redefine os --font-size-*: nenhum componente sabe
    // que a escala mudou.
    create().setSize('lg');
    expect(root().classList).toContain('text-size-lg');

    create().setSize('sm');
    expect(root().classList).toContain('text-size-sm');
    expect(root().classList).not.toContain('text-size-lg');
  });

  it('grava a escolha no store', () => {
    const store = new FakePreferencesStore();
    create(store).setSize('lg');

    expect(store.writes).toEqual([{ key: 'textSize', value: 'lg' }]);
  });

  it('a escolha guardada vale na abertura e já é aplicada', () => {
    const outro = create(new FakePreferencesStore({ textSize: 'lg' }));

    expect(outro.size()).toBe('lg');
    expect(root().classList).toContain('text-size-lg');
  });

  it.each([['gigante'], ['{quebrado'], [42], [null]])(
    'valor de tipo errado no store (%j) volta ao padrão',
    (value) => {
      expect(create(new FakePreferencesStore({ textSize: value })).size()).toBe('md');
    },
  );
});
