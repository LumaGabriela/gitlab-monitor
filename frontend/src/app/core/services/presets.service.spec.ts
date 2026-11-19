import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { PanelSnapshotModel } from '../models/api/panel-api.model';
import { ColumnOrderService } from './column-order.service';
import { ColumnVisibilityService } from './column-visibility.service';
import { GitlabMonitorService } from './gitlab-monitor.service';
import { NotifyRulesService } from './notify-rules.service';
import { Preset, PresetsService } from './presets.service';
import { RowRulesService } from './row-rules.service';

const SNAPSHOT: PanelSnapshotModel = {
  rows: [],
  collected: true,
  emptyMessage: null,
  columns: [
    { key: 'mr', label: 'MR', cell: 'link', weight: 36 },
    { key: 'author', label: 'Autor', cell: 'text', weight: 18 },
    { key: 'review', label: 'Revisão', cell: 'badge', weight: 16 },
  ],
  sorts: [
    { value: 'recent', label: 'Mais recentes', column: 'created_label', direction: 'desc' },
    { value: 'updated', label: 'Atualizados', column: 'updated_label', direction: 'desc' },
    { value: 'likes', label: 'Mais likes', column: 'likes', direction: 'desc' },
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

const SAVED: Preset = {
  id: 'p1',
  name: 'Meu preset',
  filters: {
    sort: 'likes',
    direction: null,
    author: [],
    pipeline: ['failed'],
    review: ['assigned'],
  },
  columnOrder: ['review', 'mr', 'author'],
  hiddenColumns: ['author'],
  rowRules: [
    { id: 'x', field: 'likes', operator: 'gte', value: '3', tone: 'success', enabled: true },
  ],
  notifyRules: {
    kinds: { opened: false, likes: true, pipeline: true, threads: true, left: true, review: true },
    onlyMine: true,
    minLikes: 2,
    ignoreDrafts: false,
    mutedAuthors: [],
    quietHours: null,
    cooldownMinutes: 0,
  },
};

describe('PresetsService', () => {
  let httpMock: HttpTestingController;
  let store = new FakePreferencesStore();

  /** poll() usa await: o estado só muda um microtask depois do flush. */
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  /** Sobe o monitor com colunas e ordenações conhecidas, como o bootstrap faz. */
  const boot = async (): Promise<PresetsService> => {
    const monitor = TestBed.inject(GitlabMonitorService);
    monitor.start();
    httpMock.expectOne((req) => req.url === '/data').flush(SNAPSHOT);
    await settle();
    const keys = SNAPSHOT.columns.map((column) => column.key);
    TestBed.inject(ColumnOrderService).registerColumns(keys);
    TestBed.inject(ColumnVisibilityService).registerColumns(keys);
    return TestBed.inject(PresetsService);
  };

  beforeEach(() => {
    store = new FakePreferencesStore();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), providePreferences(store)],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('oferece os presets prontos mesmo sem nada guardado', () => {
    const service = TestBed.inject(PresetsService);
    expect(service.presets().map((p) => p.id)).toEqual([
      'need-review',
      'my-stuck',
      'ready-to-merge',
    ]);
  });

  it('cai na lista de prontos quando o armazenado é inválido', () => {
    store.data['presets'] = '{quebrado';
    expect(TestBed.inject(PresetsService).presets().length).toBe(3);
  });

  it.each([[42], [null], [{ a: 1 }], ['texto']])(
    'valor de tipo errado no store (%j) cai nos prontos',
    (value) => {
      store.data['presets'] = value;
      expect(TestBed.inject(PresetsService).presets().length).toBe(3);
    },
  );

  it('grava só os presets da pessoa, nunca os prontos', async () => {
    const service = await boot();
    service.saveCurrent('Minha visão');

    const writes = store.writes.filter((write) => write.key === 'presets');
    expect(writes).toHaveLength(1);
    expect((writes[0].value as { name: string }[]).map((p) => p.name)).toEqual(['Minha visão']);
  });

  it('o armazenado que não é lista também cai nos prontos', () => {
    store.data['presets'] = { a: 1 };
    expect(TestBed.inject(PresetsService).presets().length).toBe(3);
  });

  it('descarta item inválido e campo desconhecido, e guarda o resto', () => {
    store.data['presets'] = [
      {
        id: 'ok',
        name: 'Bom',
        rowRules: [{ ...SAVED.rowRules![0] }, { id: 'y', field: 'inexistente' }],
      },
      { name: 'sem id' },
      'lixo',
      { id: 'need-review', name: 'colide com pronto' },
    ];
    const presets = TestBed.inject(PresetsService).presets();
    expect(presets.map((p) => p.id)).toEqual(['need-review', 'my-stuck', 'ready-to-merge', 'ok']);
    expect(presets[3].rowRules!.map((r) => r.id)).toEqual(['x']);
    expect(presets[0].name).not.toBe('colide com pronto');
  });

  it('o sentido da ordenação entra no preset e inverter à mão o desfaz', async () => {
    const service = await boot();
    const monitor = TestBed.inject(GitlabMonitorService);
    monitor.setSort('likes', 'asc');

    service.saveCurrent('Menos likes');
    const saved = service.presets().find((p) => p.name === 'Menos likes')!;

    expect(saved.filters.direction).toBe('asc');
    expect(service.activeId()).toBe(saved.id);

    // Mesma coluna, outro sentido: o preset deixa de descrever o que se vê.
    monitor.setSort('likes', 'desc');
    expect(service.activeId()).toBe('');

    service.apply(saved.id);
    expect(monitor.sortDirection()).toBe('asc');
  });

  it('salva o estado atual sob o nome escolhido, e isso sobrevive a nova instância', async () => {
    const service = await boot();
    const monitor = TestBed.inject(GitlabMonitorService);
    monitor.setSort('likes');
    monitor.setReview(['reviewing']);
    TestBed.inject(ColumnVisibilityService).setHidden('author', true);
    TestBed.inject(RowRulesService).add(SAVED.rowRules![0]);

    service.saveCurrent('  Minha visão ');

    const saved = service.presets().find((p) => p.name === 'Minha visão')!;
    expect(saved.filters).toEqual({
      sort: 'likes',
      direction: null,
      author: [],
      pipeline: [],
      review: ['reviewing'],
    });
    expect(saved.hiddenColumns).toEqual(['author']);
    expect(saved.columnOrder).toEqual(['mr', 'author', 'review']);
    expect(saved.rowRules!.map((r) => r.field)).toEqual(['likes']);
    expect(saved.notifyRules).not.toBeNull();

    const stored = store.lastWrite('presets') as { name: string }[];
    expect(stored.map((p) => p.name)).toEqual(['Minha visão']);
  });

  it('nome vazio não salva nada', async () => {
    const service = await boot();
    service.saveCurrent('   ');
    expect(service.presets().length).toBe(3);
  });

  it('aplica o preset a filtros, colunas e regras de uma vez', async () => {
    store.data['presets'] = [SAVED];
    const service = await boot();
    TestBed.inject(RowRulesService).add({
      field: 'draft',
      operator: 'eq',
      value: 'true',
      tone: 'danger',
      enabled: true,
    });

    service.apply('p1');

    const monitor = TestBed.inject(GitlabMonitorService);
    expect(monitor.sort()).toBe('likes');
    expect(monitor.pipeline()).toEqual(['failed']);
    expect(monitor.review()).toEqual(['assigned']);
    expect(TestBed.inject(ColumnOrderService).order()).toEqual(['review', 'mr', 'author']);
    expect(TestBed.inject(ColumnVisibilityService).hidden()).toEqual(['author']);
    expect(
      TestBed.inject(RowRulesService)
        .rules()
        .map((r) => r.field),
    ).toEqual(['likes']);
    expect(TestBed.inject(NotifyRulesService).rules().onlyMine).toBe(true);
    expect(TestBed.inject(NotifyRulesService).rules().minLikes).toBe(2);
  });

  it('descarta coluna que o backend não informa mais ao aplicar', async () => {
    store.data['presets'] = [
      {
        ...SAVED,
        columnOrder: ['approvals', 'review', 'mr'],
        hiddenColumns: ['approvals', 'author'],
      },
    ];
    const service = await boot();

    service.apply('p1');

    expect(TestBed.inject(ColumnOrderService).order()).toEqual(['review', 'mr', 'author']);
    expect(TestBed.inject(ColumnVisibilityService).hidden()).toEqual(['author']);
  });

  it('preset parcialmente inválido aplica o que vale e mantém o resto como estava', async () => {
    store.data['presets'] = [
      {
        ...SAVED,
        filters: {
          sort: 'ordenacao-que-sumiu',
          author: [],
          pipeline: [],
          review: ['assigned', 'xyz'],
        },
        rowRules: [
          {
            id: 'z',
            field: 'inexistente',
            operator: 'eq',
            value: '1',
            tone: 'danger',
            enabled: true,
          },
        ],
        notifyRules: 'quebrado',
      },
    ];
    const service = await boot();
    const monitor = TestBed.inject(GitlabMonitorService);
    monitor.setSort('updated');
    TestBed.inject(NotifyRulesService).update({ minLikes: 7 });
    TestBed.inject(RowRulesService).add(SAVED.rowRules![0]);

    service.apply('p1');

    // Ordenação que o backend não oferece: fica a atual, não vira a primeira da lista.
    expect(monitor.sort()).toBe('updated');
    expect(monitor.review()).toEqual(['assigned']);
    // Todas as regras do preset são inválidas: os destaques da pessoa ficam.
    expect(
      TestBed.inject(RowRulesService)
        .rules()
        .map((r) => r.field),
    ).toEqual(['likes']);
    // Regras de notificação ilegíveis: as atuais ficam, não voltam ao padrão.
    expect(TestBed.inject(NotifyRulesService).rules().minLikes).toBe(7);
  });

  describe('parte inválida mantém o valor atual', () => {
    const withPreset = async (patch: Record<string, unknown>): Promise<PresetsService> => {
      store.data['presets'] = [{ ...SAVED, ...patch }];
      return boot();
    };

    it('rowRules que não é lista não apaga os destaques', async () => {
      const service = await withPreset({ rowRules: 'x' });
      TestBed.inject(RowRulesService).add(SAVED.rowRules![0]);
      service.apply('p1');
      expect(TestBed.inject(RowRulesService).rules().length).toBe(1);
    });

    it('rowRules explicitamente vazia limpa os destaques', async () => {
      const service = await withPreset({ rowRules: [] });
      TestBed.inject(RowRulesService).add(SAVED.rowRules![0]);
      service.apply('p1');
      expect(TestBed.inject(RowRulesService).rules()).toEqual([]);
    });

    it('autor e pipeline que não são lista mantêm os filtros atuais', async () => {
      const service = await withPreset({
        filters: { sort: 'likes', author: 'x', pipeline: 7, review: ['xyz'] },
      });
      const monitor = TestBed.inject(GitlabMonitorService);
      monitor.setAuthor(['ana.lima']);
      monitor.setPipeline(['failed']);
      monitor.setReview(['reviewing']);
      service.apply('p1');
      expect(monitor.author()).toEqual(['ana.lima']);
      expect(monitor.pipeline()).toEqual(['failed']);
      // Revisão podada de não vazia para vazia também é inválida.
      expect(monitor.review()).toEqual(['reviewing']);
      expect(monitor.sort()).toBe('likes');
    });

    it('notifyRules sem nenhum campo conhecido mantém as regras de aviso', async () => {
      const service = await withPreset({ notifyRules: {} });
      TestBed.inject(NotifyRulesService).update({ minLikes: 7 });
      service.apply('p1');
      expect(TestBed.inject(NotifyRulesService).rules().minLikes).toBe(7);
    });

    it('ordem podada para vazia mantém a ordem atual', async () => {
      const service = await withPreset({ columnOrder: ['gone'] });
      TestBed.inject(ColumnOrderService).move('author', -1);
      service.apply('p1');
      expect(TestBed.inject(ColumnOrderService).order()).toEqual(['author', 'mr', 'review']);
    });

    it('ocultas podadas para vazia mantêm as ocultas atuais', async () => {
      const service = await withPreset({ hiddenColumns: ['gone'] });
      TestBed.inject(ColumnVisibilityService).setHidden('review', true);
      service.apply('p1');
      expect(TestBed.inject(ColumnVisibilityService).hidden()).toEqual(['review']);
    });

    it('ocultas explicitamente vazias desocultam tudo', async () => {
      const service = await withPreset({ hiddenColumns: [] });
      TestBed.inject(ColumnVisibilityService).setHidden('review', true);
      service.apply('p1');
      expect(TestBed.inject(ColumnVisibilityService).hidden()).toEqual([]);
    });
  });

  describe('ocultas que não valem', () => {
    const KEYS = SNAPSHOT.columns.map((column) => column.key);

    it('preset só com coluna morta mantém as ocultas atuais e ainda aparece como ativo', async () => {
      store.data['presets'] = [{ ...SAVED, columnOrder: null, hiddenColumns: ['gone'] }];
      const service = await boot();
      TestBed.inject(ColumnVisibilityService).setHidden('review', true);

      service.apply('p1');

      expect(TestBed.inject(ColumnVisibilityService).hidden()).toEqual(['review']);
      expect(service.activeId()).toBe('p1');
    });

    it('antes das colunas existirem, coluna morta não limpa as ocultas atuais', () => {
      store.data['presets'] = [{ ...SAVED, columnOrder: null, hiddenColumns: ['gone'] }];
      const service = TestBed.inject(PresetsService);
      const visibility = TestBed.inject(ColumnVisibilityService);
      visibility.setHidden('review', true);

      service.apply('p1');
      TestBed.inject(ColumnOrderService).registerColumns(KEYS);
      visibility.registerColumns(KEYS);
      TestBed.tick();

      expect(visibility.hidden()).toEqual(['review']);
    });

    it('antes das colunas existirem, as ocultas válidas são aplicadas quando elas chegam', () => {
      store.data['presets'] = [{ ...SAVED, columnOrder: null, hiddenColumns: ['gone', 'author'] }];
      const service = TestBed.inject(PresetsService);
      const visibility = TestBed.inject(ColumnVisibilityService);

      service.apply('p1');
      TestBed.inject(ColumnOrderService).registerColumns(KEYS);
      visibility.registerColumns(KEYS);
      TestBed.tick();

      expect(visibility.hidden()).toEqual(['author']);
    });
  });

  describe('sem crypto.randomUUID (contexto não seguro)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('aplicar e salvar continuam funcionando', async () => {
      const service = await boot();
      vi.stubGlobal('crypto', {});

      service.apply('ready-to-merge');
      service.saveCurrent('Sem uuid');

      expect(TestBed.inject(RowRulesService).rules().length).toBe(1);
      expect(service.presets().some((p) => p.name === 'Sem uuid')).toBe(true);
    });
  });

  it('id desconhecido não escreve em nenhum serviço', async () => {
    const service = await boot();
    const rules = TestBed.inject(RowRulesService);
    rules.add({ field: 'likes', operator: 'gte', value: '1', tone: 'danger', enabled: true });

    service.apply('nao-existe');

    expect(rules.rules().length).toBe(1);
  });

  it('o preset pronto não mexe em colunas nem em notificações', async () => {
    const service = await boot();
    TestBed.inject(ColumnVisibilityService).setHidden('author', true);
    TestBed.inject(NotifyRulesService).update({ minLikes: 5 });

    service.apply('need-review');

    const monitor = TestBed.inject(GitlabMonitorService);
    expect(monitor.review()).toEqual(['assigned', 'reviewing']);
    expect(monitor.sort()).toBe('updated');
    expect(
      TestBed.inject(RowRulesService)
        .rules()
        .map((r) => `${r.field}:${r.value}`),
    ).toEqual(['myReviewState:unreviewed']);
    expect(TestBed.inject(ColumnVisibilityService).hidden()).toEqual(['author']);
    expect(TestBed.inject(NotifyRulesService).rules().minLikes).toBe(5);
  });

  it('my-stuck é o que depende de mim (filtro de revisão) e está parado (regra), em E de verdade', async () => {
    const service = await boot();

    service.apply('my-stuck');

    const monitor = TestBed.inject(GitlabMonitorService);
    expect(monitor.review()).toEqual(['assigned', 'reviewing']);
    expect(monitor.sort()).toBe('updated');
    expect(
      TestBed.inject(RowRulesService)
        .rules()
        .map((r) => `${r.field}:${r.operator}:${r.value}:${r.tone}`),
    ).toEqual(['idleHours:gte:72:danger']);
  });

  it('a ordem de colunas pedida antes de as colunas existirem é aplicada quando elas chegam', async () => {
    store.data['presets'] = [SAVED];
    const service = TestBed.inject(PresetsService);
    const order = TestBed.inject(ColumnOrderService);

    service.apply('p1');
    expect(order.order()).toEqual([]);

    order.registerColumns(SNAPSHOT.columns.map((column) => column.key));
    TestBed.tick();

    expect(order.order()).toEqual(['review', 'mr', 'author']);
  });

  it('uma aplicação nova cancela a ordem que ainda esperava as colunas', async () => {
    store.data['presets'] = [SAVED];
    const service = TestBed.inject(PresetsService);
    const order = TestBed.inject(ColumnOrderService);

    service.apply('p1');
    service.apply('need-review');
    order.registerColumns(SNAPSHOT.columns.map((column) => column.key));
    TestBed.tick();

    expect(order.order()).toEqual(['mr', 'author', 'review']);
  });

  describe('activeId', () => {
    it('é o preset aplicado enquanto o estado corresponde a ele', async () => {
      const service = await boot();
      expect(service.activeId()).toBe('');

      service.apply('need-review');
      expect(service.activeId()).toBe('need-review');
    });

    it('volta a vazio quando um filtro é editado à mão', async () => {
      const service = await boot();
      service.apply('need-review');

      TestBed.inject(GitlabMonitorService).setReview(['assigned']);

      expect(service.activeId()).toBe('');
    });

    it('volta a vazio quando uma regra de destaque muda', async () => {
      const service = await boot();
      service.apply('ready-to-merge');
      expect(service.activeId()).toBe('ready-to-merge');

      const rules = TestBed.inject(RowRulesService);
      rules.update(rules.rules()[0].id, { value: 'false' });

      expect(service.activeId()).toBe('');
    });

    it('um preset guardado só casa se colunas e avisos também casam', async () => {
      store.data['presets'] = [SAVED];
      const service = await boot();
      service.apply('p1');
      expect(service.activeId()).toBe('p1');

      TestBed.inject(ColumnVisibilityService).setHidden('author', false);
      expect(service.activeId()).toBe('');
    });
  });

  it('aplicar duas vezes o mesmo preset não duplica regras', async () => {
    const service = await boot();
    service.apply('ready-to-merge');
    service.apply('ready-to-merge');
    expect(TestBed.inject(RowRulesService).rules().length).toBe(1);
  });

  it('não deixa remover nem renomear preset pronto', async () => {
    const service = await boot();
    service.rename('need-review', 'outro nome');
    service.remove('need-review');
    expect(service.presets().map((p) => p.id)).toContain('need-review');
    expect(service.presets().find((p) => p.id === 'need-review')!.name).not.toBe('outro nome');
  });

  it('renomeia e remove o preset guardado', async () => {
    store.data['presets'] = [SAVED];
    const service = await boot();

    service.rename('p1', 'Novo');
    expect(service.presets().find((p) => p.id === 'p1')!.name).toBe('Novo');
    service.rename('p1', '   ');
    expect(service.presets().find((p) => p.id === 'p1')!.name).toBe('Novo');

    service.remove('p1');
    expect(service.presets().length).toBe(3);
    expect(store.lastWrite('presets')).toEqual([]);
  });
});
