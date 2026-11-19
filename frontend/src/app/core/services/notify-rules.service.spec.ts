import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { PanelEventKind, PanelEventModel } from '../models/api/panel-api.model';
import { NotifyRulesService } from './notify-rules.service';

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
});
