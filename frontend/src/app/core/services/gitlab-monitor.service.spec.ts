import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PanelSnapshotModel } from '../models/api/panel-api.model';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { GitlabMonitorService, MAX_TARGETS } from './gitlab-monitor.service';

const SNAPSHOT: PanelSnapshotModel = {
  rows: [],
  collected: true,
  emptyMessage: { key: 'empty-target', label: 'Nenhum MR aberto para este alvo.' },
  columns: [{ key: 'mr', label: 'MR', cell: 'link', weight: 36 }],
  sorts: [
    { value: 'recent', label: 'Mais recentes', column: 'created_label', direction: 'desc' },
    {
      value: 'updated',
      label: 'Atualizados há menos tempo',
      column: 'updated_label',
      direction: 'desc',
    },
  ],
  meta: {
    projects: ['g/p'],
    targets: ['g%2Fp'],
    failed: [],
    interval: 15,
    shown: 0,
    total: 0,
    updated: '2026-11-16T10:00:00Z',
  },
  filters: { authors: [], pipelines: [] },
  error: null,
  events: [],
  sequence: 1,
  updated: '2026-11-16T10:00:00Z',
  poll: 10,
};

describe('GitlabMonitorService', () => {
  let service: GitlabMonitorService;
  let httpMock: HttpTestingController;

  /** poll() usa await: o estado só muda um microtask depois do flush. */
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  let store = new FakePreferencesStore();

  beforeEach(() => {
    store = new FakePreferencesStore();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), providePreferences(store)],
    });
    service = TestBed.inject(GitlabMonitorService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('consulta /data com a ordenação e os filtros atuais', async () => {
    service.setAuthor(['ana.lima']);

    const request = httpMock.expectOne(
      (req) =>
        req.url === '/data' &&
        req.params.get('author') === 'ana.lima' &&
        req.params.get('sort') === 'recent',
    );
    request.flush(SNAPSHOT);
    await settle();

    expect(service.snapshot()).toEqual(SNAPSHOT);
  });

  it('a resposta de uma consulta já superada não sobrescreve a mais recente', async () => {
    service.setSort('updated');
    service.setAuthor(['ana.lima']);

    const [antiga, recente] = httpMock.match((req) => req.url === '/data');
    recente.flush({ ...SNAPSHOT, sequence: 2, meta: { ...SNAPSHOT.meta, shown: 1 } });
    await settle();
    antiga.flush({ ...SNAPSHOT, sequence: 1, meta: { ...SNAPSHOT.meta, shown: 9 } });
    await settle();

    expect(service.meta().shown).toBe(1);
    expect(service.snapshot().sequence).toBe(2);
  });

  it('cada autor e cada pipeline viram um parâmetro repetido', () => {
    service.setAuthor(['ana.lima', 'bia.sa']);

    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.getAll('author')).toEqual(['ana.lima', 'bia.sa']);
    request.flush(SNAPSHOT);
  });

  it('ordenação e filtros sobrevivem a um recarregamento', async () => {
    service.setSort('updated');
    service.setAuthor(['ana.lima']);
    service.setPipeline(['success']);
    httpMock.match(() => true).forEach((req) => req.flush(SNAPSHOT));
    await settle();

    const stored: unknown = store.lastWrite('filters');
    expect(stored).toEqual({
      sort: 'updated',
      direction: null,
      author: ['ana.lima'],
      pipeline: ['success'],
      review: [],
    });
  });

  it('só manda o sentido quando ele foi pedido à mão', () => {
    // Sem o parâmetro, quem decide é o sentido natural da ordenação.
    service.setSort('likes');
    httpMock.expectOne((req) => req.url === '/data' && !req.params.has('direction')).flush(SNAPSHOT);

    service.setSort('likes', 'asc');

    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.get('direction')).toBe('asc');
    expect(service.sortDirection()).toBe('asc');
    request.flush(SNAPSHOT);
  });

  it('trocar de ordenação recomeça no sentido natural', () => {
    service.setSort('likes', 'asc');
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);

    service.setSort('author');

    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.has('direction')).toBe(false);
    expect(service.sortDirection()).toBeNull();
    request.flush(SNAPSHOT);
  });

  it('manda o filtro de revisão na consulta', () => {
    service.setReview(['assigned']);

    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.getAll('review')).toEqual(['assigned']);
    request.flush(SNAPSHOT);
  });

  it('várias opções de revisão viram um parâmetro repetido cada', () => {
    service.setReview(['assigned', 'reviewing']);

    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.getAll('review')).toEqual(['assigned', 'reviewing']);
    request.flush(SNAPSHOT);
  });

  it('limpar filtros também limpa a revisão', () => {
    service.setReview(['reviewing']);
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);

    service.resetFilters();

    expect(service.review()).toEqual([]);
    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.get('review')).toBeNull();
    request.flush(SNAPSHOT);
  });

  it('limpar filtros devolve a ordenação à primeira, no sentido natural', async () => {
    service.start();
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);
    await settle();
    service.setSort('updated', 'asc');
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);

    service.resetFilters();

    expect(service.sort()).toBe('recent');
    expect(service.sortDirection()).toBeNull();
    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.get('sort')).toBe('recent');
    expect(request.request.params.get('direction')).toBeNull();
    request.flush(SNAPSHOT);
  });

  it('sem resposta do backend, limpar filtros não troca a ordenação guardada', () => {
    service.setSort('updated', 'asc');
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);

    service.resetFilters();

    // A lista de ordenações só existe depois de `start()`: aqui não há
    // primeira opção a escolher, e a guardada fica.
    expect(service.sort()).toBe('updated');
    expect(service.sortDirection()).toBeNull();
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);
  });

  it('o erro vindo do backend é mostrado como veio', async () => {
    service.start();
    httpMock
      .expectOne((req) => req.url === '/data')
      .flush({ ...SNAPSHOT, error: 'Token sem permissão no projeto.' });
    await settle();

    expect(service.warning()).toEqual({ key: '', text: 'Token sem permissão no projeto.' });
  });

  it('o alvo que falhou no ciclo vira aviso, mesmo sem erro de coleta', async () => {
    // Ciclo parcial: as linhas do alvo que falhou não vieram. Sem o aviso, a
    // faixa ficaria verde mostrando menos MRs do que existem.
    service.start();
    httpMock
      .expectOne((req) => req.url === '/data')
      .flush({ ...SNAPSHOT, meta: { ...SNAPSHOT.meta, failed: ['g/p', 'groups/g'] } });
    await settle();

    expect(service.warning()).toEqual({
      key: 'monitor.partial-failure',
      text: null,
      params: { projects: 'g/p, groups/g' },
    });
  });

  it('a coleta seguinte sem falha nenhuma apaga o aviso parcial', async () => {
    service.start();
    httpMock
      .expectOne((req) => req.url === '/data')
      .flush({ ...SNAPSHOT, meta: { ...SNAPSHOT.meta, failed: ['g/p'] } });
    await settle();
    service.setSort('updated');
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);
    await settle();

    expect(service.warning()).toBeNull();
  });

  it('monitor fora do ar vira uma chave de tradução, não um texto fixo', async () => {
    service.start();
    httpMock.expectOne((req) => req.url === '/data').error(new ProgressEvent('erro de rede'));
    await settle();

    expect(service.warning()).toEqual({ key: 'monitor.no-response', text: null });
  });

  it('só avança o marcador de eventos quando eles foram mesmo entregues', async () => {
    // Sem isso, um aviso perdido por falta de permissão sumiria em silêncio
    // no ciclo seguinte.
    service.registerEventSink(() => false);
    service.start();
    httpMock
      .expectOne((req) => req.url === '/data')
      .flush({
        ...SNAPSHOT,
        events: [
          {
            kind: 'likes',
            text: 'MR 1 mudou',
            mr: '1:1',
            title: 'MR 1',
            author: 'ana.lima',
            url: 'https://gitlab.example/1',
            likes: 2,
            mine: false,
            involved: false,
            draft: false,
          },
        ],
        sequence: 7,
      });
    await settle();

    service.setSort('likes');
    const retry = httpMock.expectOne((req) => req.url === '/data');
    expect(retry.request.params.get('since')).toBe('0');
    retry.flush(SNAPSHOT);
  });

  it('grava o destaque de likes no store, e descarta o que não é número positivo', () => {
    service.setLikesHighlight(3.7);
    service.setLikesHighlight(-2);

    expect(store.writes.filter((write) => write.key === 'likesHighlight')).toEqual([
      { key: 'likesHighlight', value: 3 },
      { key: 'likesHighlight', value: 0 },
    ]);
    httpMock.match(() => true).forEach((req) => req.flush(SNAPSHOT));
  });

  it.each([['{quebrado'], [null], [-4], [{ a: 1 }]])(
    'destaque de likes de tipo errado no store (%j) cai em zero',
    (value) => {
      TestBed.resetTestingModule();
      store = new FakePreferencesStore({ likesHighlight: value });
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting(), providePreferences(store)],
      });

      expect(TestBed.inject(GitlabMonitorService).likesHighlight()).toBe(0);
    },
  );

  it('lê o destaque de likes guardado', () => {
    TestBed.resetTestingModule();
    store = new FakePreferencesStore({ likesHighlight: 5 });
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), providePreferences(store)],
    });

    expect(TestBed.inject(GitlabMonitorService).likesHighlight()).toBe(5);
  });
});

describe('GitlabMonitorService com os alvos monitorados', () => {
  let httpMock: HttpTestingController;
  let store: FakePreferencesStore;

  const create = (initial: Record<string, unknown> = {}): GitlabMonitorService => {
    TestBed.resetTestingModule();
    store = new FakePreferencesStore(initial);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), providePreferences(store)],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(GitlabMonitorService);
  };

  afterEach(() => {
    httpMock.match(() => true).forEach((req) => req.flush(SNAPSHOT));
    httpMock.verify();
  });

  it('guarda a escolha apenas quando o backend aceita', async () => {
    const service = create();

    const saving = service.saveSettings(['g/p', 'g2'], '30');
    const request = httpMock.expectOne((req) => req.url === '/settings');
    expect(request.request.body).toEqual({ projects: ['g/p', 'g2'], interval: '30' });
    request.flush({});
    await vi.waitFor(() =>
      httpMock
        .expectOne((req) => req.url === '/data')
        .flush({
          ...SNAPSHOT,
          meta: { ...SNAPSHOT.meta, interval: 30, targets: ['g%2Fp', 'g2'] },
        }),
    );

    expect(await saving).toBeNull();
    expect(store.lastWrite('monitoredProjects')).toEqual(['g/p', 'g2']);
    expect(store.lastWrite('interval')).toBe(30);
    // A consulta seguinte já traz a forma canônica do que o backend aceitou.
    expect(service.targets()).toEqual(['g%2Fp', 'g2']);
  });

  it('guarda o intervalo fracionário que o backend ecoa, sem arredondar', async () => {
    const service = create();

    const saving = service.saveSettings(['g/p'], '0.5');
    httpMock.expectOne((req) => req.url === '/settings').flush({});
    await vi.waitFor(() =>
      httpMock
        .expectOne((req) => req.url === '/data')
        .flush({ ...SNAPSHOT, meta: { ...SNAPSHOT.meta, interval: 0.5 } }),
    );

    expect(await saving).toBeNull();
    expect(store.lastWrite('interval')).toBe(0.5);
  });

  /** Um snapshot anterior ao salvamento, com o intervalo antigo de 15. */
  const loadPriorSnapshot = async (service: GitlabMonitorService): Promise<void> => {
    service.start();
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);
    await vi.waitFor(() => expect(service.meta().interval).toBe(15));
  };

  it('consulta que falha depois de salvar não devolve o intervalo antigo ao store', async () => {
    const service = create();
    await loadPriorSnapshot(service);

    const saving = service.saveSettings(['g/p'], '30');
    httpMock.expectOne((req) => req.url === '/settings').flush({});
    await vi.waitFor(() =>
      httpMock.expectOne((req) => req.url === '/data').error(new ProgressEvent('erro de rede')),
    );

    expect(await saving).toBeNull();
    expect(store.lastWrite('interval')).toBe(30);
  });

  it('consulta superada por outra não traz o intervalo antigo ao store', async () => {
    const service = create();
    await loadPriorSnapshot(service);

    const saving = service.saveSettings(['g/p'], '7.5');
    httpMock.expectOne((req) => req.url === '/settings').flush({});
    let daConsulta: TestRequest | undefined;
    await vi.waitFor(() => {
      daConsulta = httpMock.match((req) => req.url === '/data')[0];
      expect(daConsulta).toBeDefined();
    });
    service.setSort('updated');
    const maisRecente = httpMock.expectOne((req) => req.url === '/data');
    daConsulta?.flush(SNAPSHOT);

    expect(await saving).toBeNull();
    expect(store.lastWrite('interval')).toBe(7.5);
    maisRecente.flush(SNAPSHOT);
  });

  it('não grava a preferência quando o backend recusa', async () => {
    const service = create({ monitoredProjects: ['g/p'], interval: 15 });

    const saving = service.saveSettings([], '15');
    httpMock
      .expectOne((req) => req.url === '/settings')
      .flush(
        { error: 'Select at least one project or group.', code: 'no-targets' },
        { status: 400, statusText: 'Bad Request' },
      );

    // A recusa volta para quem chamou, com a chave do catálogo escolhida pelo
    // `code`: é a tela do Salvar que a mostra, não o Painel.
    expect(await saving).toEqual({
      key: 'settings.error-no-targets',
      text: 'Select at least one project or group.',
    });
    expect(service.warning()).toBeNull();
    expect(store.writes).toEqual([]);
    expect(service.targets()).toEqual(['g/p']);
  });

  it('parte dos alvos guardados na preferência', () => {
    const service = create({ monitoredProjects: ['g/p', 'g2'] });

    expect(service.targets()).toEqual(['g/p', 'g2']);
  });

  it.each([
    ['item de outro tipo', ['g/p', 42, 'g2']],
    ['item vazio', ['g/p', '  ']],
    ['não é lista', 'g/p'],
    ['acima do teto', Array.from({ length: MAX_TARGETS + 1 }, (_, n) => `g/p${n}`)],
  ])(
    // O Python é a autoridade sobre o arquivo, e lá a lista é tudo-ou-nada:
    // mostrar os itens válidos marcados diria que o monitor os consulta.
    'a lista guardada é tudo-ou-nada como no backend (%s)',
    (_caso, value) => {
      expect(create({ monitoredProjects: value }).targets()).toEqual([]);
    },
  );

  it('sem preferência guardada não há alvo escolhido', () => {
    expect(create().targets()).toEqual([]);
  });

  it('a escolha em vigor passa a ser a que o backend consulta', async () => {
    // Em modo web o posicional da linha de comando vence as preferências: o
    // arquivo diz um alvo, o monitor consulta outro. Quem manda é o monitor,
    // senão a aba Consulta mostraria o alvo errado marcado.
    const service = create({ monitoredProjects: ['guardado%2Fp'] });
    expect(service.targets()).toEqual(['guardado%2Fp']);

    service.start();
    httpMock
      .expectOne((req) => req.url === '/data')
      .flush({ ...SNAPSHOT, meta: { ...SNAPSHOT.meta, targets: ['cli%2Fp'] } });
    await vi.waitFor(() => expect(service.targets()).toEqual(['cli%2Fp']));

    // Reconciliar não é escolher: nada é gravado sem alguém salvar.
    expect(store.writes).toEqual([]);
  });

  it('loadTargets lê a lista de /projects', async () => {
    const service = create();
    const targets = [{ value: 'g', label: 'g', kind: 'group' }];

    const loading = service.loadTargets();
    httpMock.expectOne((req) => req.url === '/projects').flush({ targets });

    expect(await loading).toEqual(targets);
  });

  it('loadTargets propaga a falha, para a tela distinguir de lista vazia', async () => {
    const service = create();

    const loading = service.loadTargets();
    httpMock
      .expectOne((req) => req.url === '/projects')
      .flush({}, { status: 502, statusText: 'Bad Gateway' });

    await expect(loading).rejects.toBeTruthy();
  });
});

describe('GitlabMonitorService com ordenação guardada pela versão anterior', () => {
  let store = new FakePreferencesStore();

  it('descarta ordenação guardada que o backend não oferece', async () => {
    // O valor que a versão anterior guardava, antes das chaves em inglês.
    store = new FakePreferencesStore({
      filters: { sort: 'recente', author: [], pipeline: [] },
    });
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), providePreferences(store)],
    });
    const service = TestBed.inject(GitlabMonitorService);
    const httpMock = TestBed.inject(HttpTestingController);

    service.start();
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);
    await new Promise((resolve) => setTimeout(resolve));

    expect(service.sort()).toBe('recent');
    const stored: unknown = store.lastWrite('filters');
    expect(stored).toEqual({
      sort: 'recent',
      direction: null,
      author: [],
      pipeline: [],
      review: [],
    });
    httpMock.verify();
  });
});

describe('GitlabMonitorService com filtros guardados pela versão anterior', () => {
  const COLLECTED: PanelSnapshotModel = {
    ...SNAPSHOT,
    meta: { ...SNAPSHOT.meta, shown: 1, total: 1 },
    filters: {
      authors: [{ value: 'ana.lima', label: 'ana.lima' }],
      pipelines: [
        { value: 'success', label: 'sucesso' },
        { value: 'no-pipeline', label: 'sem pipeline' },
      ],
    },
  };

  let store = new FakePreferencesStore();

  const guardar = (filters: Record<string, unknown>): void => {
    store = new FakePreferencesStore({ filters });
  };

  const criar = (): { service: GitlabMonitorService; httpMock: HttpTestingController } => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), providePreferences(store)],
    });
    return {
      service: TestBed.inject(GitlabMonitorService),
      httpMock: TestBed.inject(HttpTestingController),
    };
  };

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

  it('descarta valor de revisão guardado que não existe mais', () => {
    guardar({ sort: 'recent', author: [], pipeline: [], review: ['aprovados'] });
    const { service, httpMock } = criar();

    service.start();

    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.get('review')).toBeNull();
    expect(service.review()).toEqual([]);
    request.flush(SNAPSHOT);
    httpMock.verify();
  });

  it('o sentido guardado volta na primeira consulta', () => {
    guardar({ sort: 'likes', direction: 'asc', author: [], pipeline: [], review: [] });
    const { service, httpMock } = criar();

    service.start();

    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.get('direction')).toBe('asc');
    expect(service.sortDirection()).toBe('asc');
    request.flush(SNAPSHOT);
    httpMock.verify();
  });

  it('sentido guardado fora dos dois conhecidos vale como o natural', () => {
    guardar({ sort: 'likes', direction: 'qualquer', author: [], pipeline: [], review: [] });
    const { service, httpMock } = criar();

    service.start();

    const request = httpMock.expectOne((req) => req.url === '/data');
    expect(request.request.params.has('direction')).toBe(false);
    expect(service.sortDirection()).toBeNull();
    // O resto dos filtros continua de pé: o sentido inválido não derruba nada.
    expect(service.sort()).toBe('likes');
    request.flush(SNAPSHOT);
    httpMock.verify();
  });

  it('guardado sem a chave de revisão (versão anterior) abre sem filtro de revisão', () => {
    guardar({ sort: 'recent', author: [], pipeline: [] });
    const { service, httpMock } = criar();

    service.start();

    expect(service.review()).toEqual([]);
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);
    httpMock.verify();
  });

  it('descarta o pipeline "sem-pipeline" guardado antes da renomeação para "no-pipeline"', async () => {
    guardar({ sort: 'recent', author: [], pipeline: ['sem-pipeline', 'success'], review: [] });
    const { service, httpMock } = criar();

    service.start();
    httpMock.expectOne((req) => req.url === '/data').flush(COLLECTED);
    await settle();

    expect(service.pipeline()).toEqual(['success']);
    // Já consultou com o valor morto: reconsulta sem ele, em vez de deixar a
    // tabela vazia até alguém limpar os filtros à mão.
    const again = httpMock.expectOne((req) => req.url === '/data');
    expect(again.request.params.getAll('pipeline')).toEqual(['success']);
    const stored: unknown = store.lastWrite('filters');
    expect(stored).toEqual({
      sort: 'recent',
      direction: null,
      author: [],
      pipeline: ['success'],
      review: [],
    });
    again.flush(COLLECTED);
    await settle();
    httpMock.verify();
  });

  it('descarta autor guardado que o backend não descreve mais', async () => {
    guardar({ sort: 'recent', author: ['ana.lima', 'saiu.da.lista'], pipeline: [], review: [] });
    const { service, httpMock } = criar();

    service.start();
    httpMock.expectOne((req) => req.url === '/data').flush(COLLECTED);
    await settle();

    expect(service.author()).toEqual(['ana.lima']);
    httpMock.expectOne((req) => req.url === '/data').flush(COLLECTED);
    await settle();
    httpMock.verify();
  });

  it('mantém o filtro guardado enquanto o backend ainda não tem linhas para descrevê-lo', async () => {
    guardar({ sort: 'recent', author: ['ana.lima'], pipeline: ['sem-pipeline'], review: [] });
    const { service, httpMock } = criar();

    service.start();
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);
    await settle();

    expect(service.author()).toEqual(['ana.lima']);
    expect(service.pipeline()).toEqual(['sem-pipeline']);
    httpMock.verify();
  });
});
