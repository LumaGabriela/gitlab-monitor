import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { PanelEventKind, PanelEventModel, RowFactsModel } from '../models/api/panel-api.model';
import { NotifyRule, NotifyRulesService } from './notify-rules.service';

const todos: Record<PanelEventKind, boolean> = {
  opened: true,
  likes: true,
  pipeline: true,
  threads: true,
  left: true,
  review: true,
};

const evento = (parcial: Partial<PanelEventModel> = {}): PanelEventModel => ({
  kind: 'pipeline',
  text: 'BE #7 pipeline falhou\nana.lima',
  mr: '1:7',
  title: 'Ajusta o filtro',
  author: 'ana.lima',
  url: 'https://gitlab.example/mr/7',
  likes: 0,
  mine: true,
  involved: true,
  draft: false,
  ...parcial,
});

const at = (hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 10, 16, h, m);
};

describe('NotifyRulesService', () => {
  const criar = (): NotifyRulesService => TestBed.inject(NotifyRulesService);

  let store = new FakePreferencesStore();

  beforeEach(() => {
    store = new FakePreferencesStore();
    TestBed.configureTestingModule({ providers: [providePreferences(store)] });
  });

  it('por padrão avisa tudo', () => {
    const service = criar();
    const eventos = (Object.keys(todos) as PanelEventKind[]).map((kind) => evento({ kind }));

    expect(service.filter(eventos)).toEqual(eventos);
  });

  it('deixa passar o evento de revisão quando a regra o aceita, e o barra quando não', () => {
    const service = criar();
    expect(service.filter([evento({ kind: 'review' })]).length).toBe(1);

    service.update({ kinds: { ...todos, review: false } });

    expect(service.filter([evento({ kind: 'review' })])).toEqual([]);
  });

  it('filtra por tipo de evento', () => {
    const service = criar();
    service.update({ kinds: { ...todos, likes: false } });

    expect(
      service.filter([evento({ kind: 'likes' }), evento({ kind: 'pipeline' })]).map((e) => e.kind),
    ).toEqual(['pipeline']);
  });

  it('"só o que é meu" deixa passar o meu MR e o que eu participo', () => {
    const service = criar();
    service.update({ onlyMine: true });

    expect(service.filter([evento({ involved: false }), evento({ involved: true })]).length).toBe(
      1,
    );
  });

  it('o mínimo de likes corta os eventos de MR com menos likes', () => {
    const service = criar();
    service.update({ minLikes: 3 });

    expect(
      service.filter([evento({ likes: 2 }), evento({ likes: 3 })]).map((e) => e.likes),
    ).toEqual([3]);
  });

  it('rascunho e autor silenciado não avisam', () => {
    const service = criar();
    service.update({ ignoreDrafts: true, mutedAuthors: ['bot.ci'] });

    expect(service.filter([evento({ draft: true }), evento({ author: 'bot.ci' })])).toEqual([]);
  });

  it('autor silenciado vale sem diferença de caixa', () => {
    const service = criar();
    service.update({ mutedAuthors: ['Bot.CI'] });

    expect(service.filter([evento({ author: 'bot.ci' })])).toEqual([]);
  });

  it('horário silencioso que atravessa a meia-noite cala a noite inteira', () => {
    const service = criar();
    service.update({ quietHours: { start: '19:00', end: '09:00' } });

    expect(service.filter([evento()], at('23:30'))).toEqual([]);
    expect(service.filter([evento()], at('03:00'))).toEqual([]);
    expect(service.filter([evento()], at('10:00')).length).toBe(1);
  });

  it('horário silencioso no mesmo dia cala só dentro da janela', () => {
    const service = criar();
    service.update({ quietHours: { start: '12:00', end: '13:00' } });

    expect(service.filter([evento()], at('12:30'))).toEqual([]);
    expect(service.filter([evento()], at('13:00')).length).toBe(1);
    expect(service.filter([evento()], at('11:59')).length).toBe(1);
  });

  it('a espera vale por MR, não para o painel inteiro', () => {
    const service = criar();
    service.update({ cooldownMinutes: 10 });
    service.markNotified([evento({ url: 'https://gitlab.example/a/mr/7' })], at('10:00'));

    expect(
      service
        .filter(
          [
            evento({ url: 'https://gitlab.example/a/mr/7' }),
            evento({ url: 'https://gitlab.example/a/mr/8' }),
          ],
          at('10:05'),
        )
        .map((e) => e.url),
    ).toEqual(['https://gitlab.example/a/mr/8']);
  });

  it('a espera é por URL: o mesmo !7 em dois alvos não cala o outro', () => {
    // `mr` é o número dentro do alvo: dois projetos monitorados juntos repetem
    // o mesmo "7". A URL é o que distingue um MR do outro.
    const service = criar();
    service.update({ cooldownMinutes: 10 });
    service.markNotified(
      [evento({ mr: '7', url: 'https://gitlab.example/a/-/merge_requests/7' })],
      at('10:00'),
    );

    expect(
      service.filter(
        [evento({ mr: '7', url: 'https://gitlab.example/b/-/merge_requests/7' })],
        at('10:05'),
      ).length,
    ).toBe(1);
  });

  it('passada a espera, o MR volta a avisar', () => {
    const service = criar();
    service.update({ cooldownMinutes: 10 });
    service.markNotified([evento({ url: 'https://gitlab.example/a/mr/7' })], at('10:00'));

    expect(
      service.filter([evento({ url: 'https://gitlab.example/a/mr/7' })], at('10:10')).length,
    ).toBe(1);
  });

  it('eventos do mesmo MR no mesmo lote passam juntos', () => {
    const service = criar();
    service.update({ cooldownMinutes: 10 });

    expect(
      service.filter([evento({ kind: 'likes' }), evento({ kind: 'pipeline' })], at('10:00')).length,
    ).toBe(2);
  });

  it('filter só decide: sem markNotified a espera não começa', () => {
    const service = criar();
    service.update({ cooldownMinutes: 10 });

    service.filter([evento()], at('10:00'));

    expect(service.filter([evento()], at('10:01')).length).toBe(1);
  });

  it('evento calado pelo horário silencioso não inicia a espera do MR', () => {
    const service = criar();
    service.update({ cooldownMinutes: 10, quietHours: { start: '19:00', end: '09:00' } });
    service.markNotified(service.filter([evento()], at('23:00')), at('23:00'));

    service.update({ quietHours: null });
    expect(service.filter([evento()], at('23:02')).length).toBe(1);
  });

  it('lembra a escolha entre sessões', () => {
    criar().update({ minLikes: 4, mutedAuthors: ['bot.ci'] });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [providePreferences(store)] });

    expect(criar().rules().minLikes).toBe(4);
    expect(criar().rules().mutedAuthors).toEqual(['bot.ci']);
  });

  it('grava a escolha no store', () => {
    const service = criar();
    service.update({ minLikes: 4 });

    expect(store.writes).toEqual([{ key: 'notifyRules', value: service.rules() }]);
    expect(store.lastWrite('notifyRules')).toMatchObject({ minLikes: 4 });
  });

  it.each([['{não é json'], [42], [null], [['lista']]])(
    'valor de tipo errado no store (%j) volta ao padrão de avisar tudo',
    (value) => {
      store.data['notifyRules'] = value;

      expect(criar().filter([evento()]).length).toBe(1);
    },
  );

  it('campo de tipo errado é descartado sem perder os que estão certos', () => {
    store.data['notifyRules'] = {
      minLikes: 'muitos',
      onlyMine: true,
      quietHours: { start: 'x', end: 1 },
    };
    const rules = criar().rules();

    expect(rules.minLikes).toBe(0);
    expect(rules.onlyMine).toBe(true);
    expect(rules.quietHours).toBeNull();
    expect(rules.kinds).toEqual(todos);
  });

  describe('regras de critério', () => {
    const fatos = (parcial: Partial<RowFactsModel> = {}): RowFactsModel => ({
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
      ...parcial,
    });
    const comFatos = (
      parcial: Partial<RowFactsModel>,
      evt: Partial<PanelEventModel> = {},
    ): PanelEventModel => evento({ facts: fatos(parcial), ...evt });
    const criterio = (parcial: Partial<NotifyRule> = {}): NotifyRule => ({
      id: 'r1',
      field: 'likes',
      operator: 'gte',
      value: '3',
      mode: 'notify',
      kinds: [],
      enabled: true,
      ...parcial,
    });
    // Os critérios só decidem quando são o lado escolhido; com o Geral, não valem.
    const comRegras = (...regras: NotifyRule[]): NotifyRulesService => {
      const service = criar();
      service.update({ decider: 'rules', rules: regras });
      return service;
    };

    it('lê regra sem kinds, com kinds vazia e com tipo desconhecido como "todos os tipos"', () => {
      const semKinds: Record<string, unknown> = { ...criterio() };
      delete semKinds['kinds'];
      store.data['notifyRules'] = {
        rules: [
          semKinds,
          criterio({ id: 'b', kinds: [] }),
          criterio({ id: 'c', kinds: ['inexistente' as PanelEventKind] }),
          { ...criterio({ id: 'd' }), kinds: 'likes' },
          criterio({ id: 'e', kinds: ['inexistente' as PanelEventKind, 'likes'] }),
        ],
      };

      expect(
        criar()
          .rules()
          .rules.map((r) => r.kinds),
      ).toEqual([[], [], [], [], ['likes']]);
    });

    it('descarta item de campo, operador ou modo desconhecido, mantendo os vizinhos', () => {
      store.data['notifyRules'] = {
        rules: [
          criterio({ id: 'a' }),
          { ...criterio({ id: 'b' }), field: 'inexistente' },
          { ...criterio({ id: 'c' }), operator: 'maior' },
          { ...criterio({ id: 'd' }), mode: 'avisar' },
          'lixo',
          criterio({ id: 'e' }),
        ],
      };

      expect(
        criar()
          .rules()
          .rules.map((r) => r.id),
      ).toEqual(['a', 'e']);
    });

    it('volta à lista vazia quando rules não é lista', () => {
      for (const rules of [null, 'x', 3, { a: 1 }]) {
        store.data['notifyRules'] = { rules };
        expect(criar().rules().rules).toEqual([]);
      }
    });

    it('descarta o evento que uma regra mute ligada cobre', () => {
      const service = comRegras(
        criterio({ field: 'draft', operator: 'eq', value: 'true', mode: 'mute' }),
      );
      const quieto = comFatos({ draft: true });
      const normal = comFatos({ draft: false });

      expect(service.filter([quieto, normal])).toEqual([normal]);
    });

    it('ignora regra mute desligada', () => {
      const service = comRegras(
        criterio({ field: 'draft', operator: 'eq', value: 'true', mode: 'mute', enabled: false }),
      );
      const evt = comFatos({ draft: true });

      expect(service.filter([evt])).toEqual([evt]);
    });

    it('com regra notify cobrindo o tipo, só passa o evento que casa com alguma', () => {
      const service = comRegras(criterio());
      const casa = comFatos({ likes: 5 });

      expect(service.filter([casa, comFatos({ likes: 1 })])).toEqual([casa]);
    });

    it('não mexe nos tipos que nenhuma regra notify cobre', () => {
      const service = comRegras(criterio({ kinds: ['likes'] }));
      const likes = comFatos({ likes: 1 }, { kind: 'likes' });
      const pipeline = comFatos({ likes: 1 }, { kind: 'pipeline' });

      expect(service.filter([likes, pipeline])).toEqual([pipeline]);
    });

    it('regra notify desligada não põe o tipo em lista de inclusão', () => {
      const service = comRegras(criterio({ enabled: false }));
      const evt = comFatos({ likes: 0 });

      expect(service.filter([evt])).toEqual([evt]);
    });

    it('mute vence notify para o mesmo evento', () => {
      const service = comRegras(
        criterio({ id: 'a' }),
        criterio({ id: 'b', field: 'author', operator: 'eq', value: 'ana.lima', mode: 'mute' }),
      );

      expect(service.filter([comFatos({ likes: 9 })])).toEqual([]);
    });

    it('só regras mute ligadas não bloqueiam quem elas não cobrem', () => {
      const service = comRegras(
        criterio({ field: 'draft', operator: 'eq', value: 'true', mode: 'mute' }),
      );
      const evt = comFatos({ draft: false });

      expect(service.filter([evt])).toEqual([evt]);
    });

    it('evento sem facts passa intocado por critério nenhum', () => {
      // `left` nunca traz facts: o MR saiu da lista. Nem mute o descarta, nem a
      // restrição de notify o alcança.
      const service = comRegras(
        criterio(),
        criterio({ id: 'b', field: 'draft', operator: 'neq', value: 'true', mode: 'mute' }),
      );
      const saiu = evento({ kind: 'left' });

      expect(saiu.facts).toBeUndefined();
      expect(service.filter([saiu])).toEqual([saiu]);
    });

    it('facts nulo ou que não é objeto vale como sem facts', () => {
      const service = comRegras(criterio());
      for (const facts of [null, [], 'x', 3]) {
        const evt = { ...evento(), facts } as unknown as PanelEventModel;
        expect(service.filter([evt])).toEqual([evt]);
      }
    });

    it('com os critérios decidindo, o tipo desligado no Geral não cala', () => {
      // Um lado só vale por vez: o `kinds` é do Geral, e ali ele não é consultado.
      const service = comRegras(criterio({ value: '0' }));
      service.update({ kinds: { ...todos, likes: false } });
      const aviso = comFatos({ likes: 5 }, { kind: 'likes' });

      expect(service.filter([aviso])).toEqual([aviso]);

      service.update({ decider: 'general' });
      expect(service.filter([aviso])).toEqual([]);
    });

    it('com o Geral decidindo, o critério mute não descarta nada', () => {
      const service = criar();
      service.update({
        rules: [criterio({ mode: 'mute', value: '0' })],
      });
      const aviso = comFatos({ likes: 5 }, { kind: 'likes' });

      expect(service.filter([aviso])).toEqual([aviso]);
    });

    it('o horário silencioso e a espera valem nos dois lados', () => {
      const service = comRegras(criterio({ value: '0' }));
      service.update({ quietHours: { start: '00:00', end: '23:59' } });

      expect(service.filter([comFatos({ likes: 5 })], new Date(2026, 0, 1, 12, 0))).toEqual([]);
    });

    it('addRule nasce desligada, updateRule altera e removeRule apaga', () => {
      const service = comRegras();
      service.addRule();
      const [nova] = service.rules().rules;

      expect(nova.enabled).toBe(false);
      expect(nova.kinds).toEqual([]);
      expect(service.filter([comFatos({ likes: 0 })]).length).toBe(1);

      service.updateRule(nova.id, { mode: 'mute', enabled: true, value: '0' });
      expect(service.rules().rules[0]).toMatchObject({ id: nova.id, mode: 'mute', enabled: true });
      expect(service.filter([comFatos({ likes: 0 })])).toEqual([]);

      service.removeRule(nova.id);
      expect(service.rules().rules).toEqual([]);
      expect(store.lastWrite('notifyRules')).toMatchObject({ rules: [] });
    });
  });
});
