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
});
