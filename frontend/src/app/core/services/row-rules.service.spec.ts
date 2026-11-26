import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { RowFactsModel } from '../models/api/panel-api.model';
import { ROW_RULE_SUGGESTIONS, RowRulesService } from './row-rules.service';

const FACTS: RowFactsModel = {
  likes: 0,
  unresolved: 0,
  participants: 0,
  mergeable: null,
  conflicts: null,
  pipeline: 'failed',
  author: 'ana.lima',
  mine: false,
  involved: false,
  draft: false,
  ageHours: 0,
  idleHours: 0,
  assignedToMe: false,
  reviewingMine: false,
  myReviewState: '',
  assignees: 0,
  reviewers: 0,
};

const NEW_RULE = {
  field: 'pipeline',
  operator: 'eq',
  value: 'failed',
  tone: 'danger',
  markStyle: 'solid',
  enabled: true,
} as const;

describe('RowRulesService', () => {
  let store = new FakePreferencesStore();
  const create = (): RowRulesService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [providePreferences(store)] });
    return TestBed.inject(RowRulesService);
  };

  beforeEach(() => {
    store = new FakePreferencesStore();
  });

  it('sem preferência, não há regra e nenhuma linha ganha tom', () => {
    const service = create();
    expect(service.rules()).toEqual([]);
    expect(service.toneFor(FACTS)).toBeNull();
  });

  it('a regra criada ganha id, persiste e recarrega', () => {
    const service = create();
    service.add(NEW_RULE);
    expect(service.rules()[0].id).toBeTruthy();

    expect(create().rules()).toEqual(service.rules());
  });

  it('grava a escolha no store', () => {
    const service = create();
    service.add(NEW_RULE);

    expect(store.writes).toEqual([{ key: 'rowRules', value: service.rules() }]);
  });

  it('o tom vem da primeira regra ligada que casa', () => {
    const service = create();
    service.add({ ...NEW_RULE, tone: 'warning', enabled: false });
    service.add(NEW_RULE);
    expect(service.toneFor(FACTS)).toBe('danger');
  });

  it('matchFor devolve a regra inteira que casou, e nulo quando nenhuma casa', () => {
    const service = create();
    expect(service.matchFor(FACTS)).toBeNull();
    service.add(NEW_RULE);
    expect(service.matchFor(FACTS)?.id).toBe(service.rules()[0].id);
    expect(service.matchFor({ ...FACTS, pipeline: 'success' })).toBeNull();
  });

  it('atualiza e remove pelo id', () => {
    const service = create();
    service.add(NEW_RULE);
    const { id } = service.rules()[0];

    service.update(id, { tone: 'success' });
    expect(service.rules()[0].tone).toBe('success');
    expect(create().rules()[0].tone).toBe('success');

    service.remove(id);
    expect(service.rules()).toEqual([]);
    expect(create().rules()).toEqual([]);
  });

  describe('move', () => {
    const comTres = (): RowRulesService => {
      const service = create();
      service.add({ ...NEW_RULE, value: 'a' });
      service.add({ ...NEW_RULE, value: 'b' });
      service.add({ ...NEW_RULE, value: 'c' });
      return service;
    };
    const ordem = (service: RowRulesService): string[] =>
      service.rules().map((rule) => rule.value);
    const idDe = (service: RowRulesService, value: string): string =>
      service.rules().find((rule) => rule.value === value)?.id ?? '';

    it('move troca a regra com a vizinha de baixo', () => {
      const service = comTres();
      service.move(idDe(service, 'b'), 1);
      expect(ordem(service)).toEqual(['a', 'c', 'b']);
      expect(ordem(create())).toEqual(['a', 'c', 'b']);
    });

    it('move troca a regra com a vizinha de cima', () => {
      const service = comTres();
      service.move(idDe(service, 'b'), -1);
      expect(ordem(service)).toEqual(['b', 'a', 'c']);
      expect(ordem(create())).toEqual(['b', 'a', 'c']);
    });

    it('move grava a lista inteira no store', () => {
      const service = comTres();
      service.move(idDe(service, 'b'), -1);
      expect(store.writes.at(-1)).toEqual({ key: 'rowRules', value: service.rules() });
    });

    it('move na primeira para cima não muda nada e não grava', () => {
      const service = comTres();
      const escritas = store.writes.length;
      service.move(idDe(service, 'a'), -1);
      expect(ordem(service)).toEqual(['a', 'b', 'c']);
      expect(store.writes.length).toBe(escritas);
    });

    it('move na última para baixo não muda nada e não grava', () => {
      const service = comTres();
      const escritas = store.writes.length;
      service.move(idDe(service, 'c'), 1);
      expect(ordem(service)).toEqual(['a', 'b', 'c']);
      expect(store.writes.length).toBe(escritas);
    });

    it('move com id desconhecido não muda nada e não grava', () => {
      const service = comTres();
      const escritas = store.writes.length;
      service.move('nao-existe', 1);
      expect(ordem(service)).toEqual(['a', 'b', 'c']);
      expect(store.writes.length).toBe(escritas);
    });
  });

  it('regra com campo desconhecido no armazenamento é descartada na leitura', () => {
    // Review Focus 5: um fato que deixou de existir não pode derrubar o painel.
    const valida = { id: 'a', ...NEW_RULE };
    store = new FakePreferencesStore({
      rowRules: [
        valida,
        { ...valida, id: 'b', field: 'campoQueNaoExiste' },
        { ...valida, id: 'c', operator: 'contem' },
        { ...valida, id: 'd', tone: 'roxo' },
        { ...valida, id: 'e', value: 3 },
        'lixo',
        null,
      ],
    });
    expect(create().rules()).toEqual([valida]);
  });

  it.each([['{nao e json'], [42], [null], [{ a: 1 }]])(
    'valor de tipo errado no store (%j) mantém o padrão',
    (value) => {
      store = new FakePreferencesStore({ rowRules: value });
      expect(create().rules()).toEqual([]);
    },
  );

  it('as sugestões são regras prontas e válidas', () => {
    const service = create();
    for (const suggestion of ROW_RULE_SUGGESTIONS) service.add(suggestion.rule);
    expect(service.rules()).toHaveLength(ROW_RULE_SUGGESTIONS.length);
    expect(create().rules()).toHaveLength(ROW_RULE_SUGGESTIONS.length);
  });

  it('aceita item sem markStyle e item com markStyle desconhecido, já normalizados', () => {
    store = new FakePreferencesStore();
    const base = { operator: 'eq', value: 'failed', enabled: true };
    store.write('rowRules', [
      { ...base, id: 'a', field: 'pipeline', tone: 'warning' },
      { ...base, id: 'b', field: 'pipeline', tone: 'info', markStyle: 'neon' },
      { ...base, id: 'c', field: 'pipeline', tone: 'danger', markStyle: 'dotted' },
    ]);
    const rules = create().rules();
    expect(rules.map((r) => r.markStyle)).toEqual(['dashed', 'solid', 'dotted']);
  });
});
