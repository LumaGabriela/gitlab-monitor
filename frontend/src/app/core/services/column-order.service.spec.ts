import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { ColumnOrderService } from './column-order.service';

describe('ColumnOrderService', () => {
  let store = new FakePreferencesStore();
  const create = (): ColumnOrderService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [providePreferences(store)] });
    return TestBed.inject(ColumnOrderService);
  };

  beforeEach(() => {
    store = new FakePreferencesStore();
  });

  it('sem preferência, a ordem é a que o backend informou', () => {
    const service = create();
    service.registerColumns(['likes', 'mr', 'author']);
    expect(service.order()).toEqual(['likes', 'mr', 'author']);
  });

  it('mover troca a coluna com a vizinha e persiste', () => {
    const service = create();
    service.registerColumns(['likes', 'mr', 'author']);
    service.move('mr', -1);
    expect(service.order()).toEqual(['mr', 'likes', 'author']);
    expect(store.writes).toEqual([{ key: 'columnOrder', value: ['mr', 'likes', 'author'] }]);
  });

  it('mover para baixo troca com a vizinha de baixo', () => {
    const service = create();
    service.registerColumns(['likes', 'mr', 'author']);
    service.move('likes', 1);
    expect(service.order()).toEqual(['mr', 'likes', 'author']);
  });

  it('não sai das pontas', () => {
    const service = create();
    service.registerColumns(['likes', 'mr']);
    service.move('likes', -1);
    service.move('mr', 1);
    expect(service.order()).toEqual(['likes', 'mr']);
  });

  it('coluna nova entra no fim e chave órfã é descartada', () => {
    store = new FakePreferencesStore({ columnOrder: ['antiga', 'mr'] });
    const service = create();
    service.registerColumns(['likes', 'mr', 'author']);
    expect(service.order()).toEqual(['mr', 'likes', 'author']);
  });

  it.each([['{ quebrado'], [42], [null], [{ a: 1 }]])(
    'valor de tipo errado no store (%j) não derruba o padrão',
    (value) => {
      store = new FakePreferencesStore({ columnOrder: value });
      const service = create();
      service.registerColumns(['likes', 'mr']);
      expect(service.order()).toEqual(['likes', 'mr']);
    },
  );

  it('antes da primeira resposta do backend, a preferência salva sobrevive', () => {
    store = new FakePreferencesStore({ columnOrder: ['mr', 'likes'] });
    const service = create();
    service.registerColumns([]);
    service.registerColumns(['likes', 'mr']);
    expect(service.order()).toEqual(['mr', 'likes']);
  });

  it('restaurar volta à ordem do backend e esquece a preferência', () => {
    const service = create();
    service.registerColumns(['likes', 'mr']);
    service.move('mr', -1);
    service.reset();
    expect(service.order()).toEqual(['likes', 'mr']);
    expect(store.lastWrite('columnOrder')).toEqual([]);
  });

  it('sort() ordena colunas pela posição escolhida', () => {
    const service = create();
    service.registerColumns(['likes', 'mr', 'author']);
    service.move('author', -1);
    const sorted = service.sort([{ key: 'likes' }, { key: 'mr' }, { key: 'author' }]);
    expect(sorted.map((column) => column.key)).toEqual(['likes', 'author', 'mr']);
  });

  it('sort() deixa no fim a coluna que ainda não foi registrada', () => {
    const service = create();
    service.registerColumns(['mr']);
    const sorted = service.sort([{ key: 'nova' }, { key: 'mr' }]);
    expect(sorted.map((column) => column.key)).toEqual(['mr', 'nova']);
  });
});
