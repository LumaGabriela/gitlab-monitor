import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { DENSITIES, DensityService } from './density.service';

describe('DensityService', () => {
  const root = (): HTMLElement => document.documentElement;
  const create = (store: FakePreferencesStore = new FakePreferencesStore()): DensityService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [providePreferences(store)] });
    return TestBed.inject(DensityService);
  };

  beforeEach(() => root().classList.remove('density-compact'));
  afterEach(() => root().classList.remove('density-compact'));

  it('oferece as duas densidades', () => {
    expect(DENSITIES).toEqual(['comfortable', 'compact']);
  });

  it('começa em comfortable, sem classe nenhuma', () => {
    expect(create().density()).toBe('comfortable');
    expect(root().className).not.toContain('density');
  });

  it('aplica a classe no <html>', () => {
    const service = create();
    service.setDensity('compact');
    expect(service.density()).toBe('compact');
    expect(root().classList).toContain('density-compact');

    service.setDensity('comfortable');
    expect(root().classList).not.toContain('density-compact');
  });

  it('grava a escolha no store', () => {
    const store = new FakePreferencesStore();
    const service = create(store);
    service.setDensity('compact');
    service.setDensity('comfortable');

    expect(store.writes).toEqual([
      { key: 'density', value: 'compact' },
      { key: 'density', value: 'comfortable' },
    ]);
  });

  it('a escolha guardada vale na abertura e já é aplicada', () => {
    expect(create(new FakePreferencesStore({ density: 'compact' })).density()).toBe('compact');
    expect(root().classList).toContain('density-compact');
  });

  it('ignora densidade desconhecida', () => {
    const store = new FakePreferencesStore();
    const service = create(store);
    service.setDensity('apertada' as never);
    expect(service.density()).toBe('comfortable');
    expect(store.writes).toEqual([]);
  });

  it.each([['{quebrado'], [42], [null], ['"compact"']])(
    'valor de tipo errado no store (%j) cai no padrão',
    (value) => {
      expect(create(new FakePreferencesStore({ density: value })).density()).toBe('comfortable');
    },
  );
});
