import { RowFactsModel } from '../models/api/panel-api.model';
import {
  HighlightRule,
  defaultValueFor,
  firstMatch,
  firstTone,
  keepOperator,
  markStyleOf,
  matches,
  operatorsFor,
} from './rule-engine';

const FACTS: RowFactsModel = {
  likes: 0,
  unresolved: 0,
  participants: 0,
  mergeable: null,
  conflicts: null,
  pipeline: '',
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

const facts = (patch: Partial<RowFactsModel> = {}): RowFactsModel => ({ ...FACTS, ...patch });

const rule = (patch: Partial<HighlightRule> = {}): HighlightRule => ({
  id: 'r1',
  field: 'likes',
  operator: 'gte',
  value: '1',
  tone: 'danger',
  markStyle: 'solid',
  enabled: true,
  ...patch,
});

describe('rule-engine', () => {
  it('compara número com o operador escolhido', () => {
    expect(
      matches(rule({ field: 'likes', operator: 'gte', value: '2' }), facts({ likes: 2 })),
    ).toBe(true);
    expect(
      matches(rule({ field: 'idleHours', operator: 'gte', value: '72' }), facts({ idleHours: 12 })),
    ).toBe(false);
    expect(
      matches(rule({ field: 'likes', operator: 'lte', value: '2' }), facts({ likes: 3 })),
    ).toBe(false);
    expect(matches(rule({ field: 'likes', operator: 'eq', value: '3' }), facts({ likes: 3 }))).toBe(
      true,
    );
    expect(
      matches(rule({ field: 'likes', operator: 'neq', value: '3' }), facts({ likes: 3 })),
    ).toBe(false);
    expect(
      matches(rule({ field: 'likes', operator: 'neq', value: '3' }), facts({ likes: 4 })),
    ).toBe(true);
  });

  it('compara texto e booleano sem diferenciar maiúsculas', () => {
    expect(
      matches(
        rule({ field: 'pipeline', operator: 'eq', value: 'Failed' }),
        facts({ pipeline: 'failed' }),
      ),
    ).toBe(true);
    expect(
      matches(
        rule({ field: 'pipeline', operator: 'neq', value: 'Failed' }),
        facts({ pipeline: 'success' }),
      ),
    ).toBe(true);
    expect(
      matches(
        rule({ field: 'conflicts', operator: 'eq', value: 'true' }),
        facts({ conflicts: true }),
      ),
    ).toBe(true);
    expect(
      matches(
        rule({ field: 'conflicts', operator: 'eq', value: 'TRUE' }),
        facts({ conflicts: true }),
      ),
    ).toBe(true);
    expect(
      matches(rule({ field: 'draft', operator: 'neq', value: 'true' }), facts({ draft: false })),
    ).toBe(true);
  });

  it('fato desconhecido (null) não casa com igualdade', () => {
    expect(
      matches(
        rule({ field: 'mergeable', operator: 'eq', value: 'true' }),
        facts({ mergeable: null }),
      ),
    ).toBe(false);
    expect(
      matches(
        rule({ field: 'mergeable', operator: 'eq', value: 'false' }),
        facts({ mergeable: null }),
      ),
    ).toBe(false);
  });

  it('valor vazio, negativo ou não numérico nunca casa', () => {
    // Review Focus 3: regra pela metade não pode pintar a tabela inteira.
    for (const operator of ['gte', 'lte', 'eq', 'neq'] as const) {
      for (const value of ['', ' ', 'abc', '-1', 'Infinity']) {
        expect(matches(rule({ field: 'likes', operator, value }), facts({ likes: 5 }))).toBe(false);
      }
    }
  });

  it('valor vazio ou fora de true/false nunca casa em texto e booleano', () => {
    for (const operator of ['eq', 'neq'] as const) {
      expect(
        matches(rule({ field: 'pipeline', operator, value: ' ' }), facts({ pipeline: 'failed' })),
      ).toBe(false);
      expect(
        matches(
          rule({ field: 'conflicts', operator, value: 'talvez' }),
          facts({ conflicts: true }),
        ),
      ).toBe(false);
    }
  });

  it('maior ou menor que não se aplica a texto nem a booleano', () => {
    expect(
      matches(
        rule({ field: 'pipeline', operator: 'gte', value: 'failed' }),
        facts({ pipeline: 'failed' }),
      ),
    ).toBe(false);
    expect(
      matches(rule({ field: 'draft', operator: 'lte', value: 'true' }), facts({ draft: true })),
    ).toBe(false);
  });

  it('regra desligada não conta, e a primeira que casa decide o tom', () => {
    const regras = [
      rule({ enabled: false, tone: 'success' }),
      rule({ tone: 'danger' }),
      rule({ tone: 'warning' }),
    ];
    expect(firstTone(regras, facts({ likes: 9 }))).toBe('danger');
  });

  it('devolve a primeira regra ligada que casa, não só o tom', () => {
    const regras = [
      rule({ id: 'r0', enabled: false }),
      rule({ id: 'r1', value: '99' }),
      rule({ id: 'r2', tone: 'warning' }),
    ];
    expect(firstMatch(regras, facts({ likes: 9 }))?.id).toBe('r2');
    expect(firstMatch(regras, facts({ likes: 0 }))).toBeNull();
  });

  it('sem regra que case, não há tom', () => {
    expect(firstTone([rule({ value: '5' })], facts({ likes: 1 }))).toBeNull();
    expect(firstTone([], facts())).toBeNull();
  });

  it('casa a regra de revisão pendente atribuída a mim', () => {
    const pendente = rule({ field: 'myReviewState', operator: 'eq', value: 'unreviewed' });

    expect(matches(pendente, facts({ myReviewState: 'unreviewed' }))).toBe(true);
    expect(matches(pendente, facts({ myReviewState: 'approved' }))).toBe(false);
  });

  it('não casa regra de estado de revisão quando o fato é vazio, salvo por neq', () => {
    // Alvo vazio nunca casa; fato vazio só não casa por igualdade.
    expect(matches(rule({ field: 'myReviewState', operator: 'eq', value: '' }), facts())).toBe(
      false,
    );
    expect(
      matches(rule({ field: 'myReviewState', operator: 'eq', value: 'unreviewed' }), facts()),
    ).toBe(false);
  });

  it('um estado de revisão vazio não é "approved", então neq o inclui', () => {
    // Mesma semântica do fato booleano desconhecido: só `neq` o inclui.
    const naoAprovado = rule({ field: 'myReviewState', operator: 'neq', value: 'approved' });

    expect(matches(naoAprovado, facts({ myReviewState: '' }))).toBe(true);
    expect(matches(naoAprovado, facts({ myReviewState: 'approved' }))).toBe(false);
  });

  it('lê o estado de revisão como texto, inclusive os que o GitLab acrescenta', () => {
    expect(
      matches(
        rule({ field: 'myReviewState', operator: 'eq', value: 'review_started' }),
        facts({ myReviewState: 'review_started' }),
      ),
    ).toBe(true);
  });

  it('compara os fatos de atribuição e revisão com o tipo certo', () => {
    expect(
      matches(
        rule({ field: 'assignedToMe', operator: 'eq', value: 'true' }),
        facts({ assignedToMe: true }),
      ),
    ).toBe(true);
    expect(matches(rule({ field: 'reviewingMine', operator: 'eq', value: 'true' }), facts())).toBe(
      false,
    );
    expect(
      matches(rule({ field: 'assignees', operator: 'eq', value: '0' }), facts({ assignees: 0 })),
    ).toBe(true);
    expect(
      matches(rule({ field: 'reviewers', operator: 'gte', value: '2' }), facts({ reviewers: 1 })),
    ).toBe(false);
  });
});

describe('operadores e valor por tipo de campo', () => {
  it('número aceita os quatro operadores; booleano e texto, só igualdade', () => {
    expect(operatorsFor('likes')).toEqual(['gte', 'lte', 'eq', 'neq']);
    expect(operatorsFor('conflicts')).toEqual(['eq', 'neq']);
    expect(operatorsFor('author')).toEqual(['eq', 'neq']);
  });

  it('trocar para um campo que não aceita o operador cai em igual a', () => {
    expect(keepOperator('conflicts', 'gte')).toBe('eq');
    expect(keepOperator('likes', 'gte')).toBe('gte');
    expect(keepOperator('author', 'neq')).toBe('neq');
  });

  it('booleano começa em sim; número e texto começam vazios', () => {
    expect(defaultValueFor('conflicts')).toBe('true');
    expect(defaultValueFor('likes')).toBe('');
    expect(defaultValueFor('author')).toBe('');
  });

  it('o operador que o tipo não aceita nunca casa: é por isso que ele não é oferecido', () => {
    const rule = {
      id: 'r',
      field: 'conflicts' as const,
      operator: 'gte' as const,
      value: 'true',
      tone: 'danger' as const,
      markStyle: 'solid' as const,
      enabled: true,
    };
    expect(matches(rule, facts({ conflicts: true }))).toBe(false);
  });
});

describe('markStyleOf', () => {
  it('devolve o traço que o tom já desenhava quando a regra não traz markStyle', () => {
    expect(markStyleOf({ tone: 'danger' })).toBe('solid');
    expect(markStyleOf({ tone: 'warning' })).toBe('dashed');
    expect(markStyleOf({ tone: 'success' })).toBe('double');
    expect(markStyleOf({ tone: 'strong' })).toBe('dotted');
  });

  it('devolve o traço guardado quando ele é conhecido', () => {
    expect(markStyleOf({ tone: 'danger', markStyle: 'dotted' })).toBe('dotted');
  });

  it('descarta traço desconhecido e volta ao padrão do tom', () => {
    expect(markStyleOf({ tone: 'warning', markStyle: 'neon' })).toBe('dashed');
  });

  it('dá solid aos tons novos, que não tinham traço antes', () => {
    expect(markStyleOf({ tone: 'info' })).toBe('solid');
    expect(markStyleOf({ tone: 'neutral' })).toBe('solid');
  });
});

it('aceita regra de tom novo', () => {
  expect(
    matches(
      rule({ field: 'likes', operator: 'gte', value: '1', tone: 'info', markStyle: 'dotted' }),
      facts({ likes: 2 }),
    ),
  ).toBe(true);
});
