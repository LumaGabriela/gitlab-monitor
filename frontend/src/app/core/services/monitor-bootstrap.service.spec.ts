import { provideHttpClient } from '@angular/common/http';
import { effect } from '@angular/core';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { provideTestTranslate } from '../../../testing/translate';
import { ColumnOrderService } from './column-order.service';
import { ColumnVisibilityService } from './column-visibility.service';
import { GitlabMonitorService } from './gitlab-monitor.service';
import { MonitorBootstrapService } from './monitor-bootstrap.service';
import { NotificationsService } from './notifications.service';
import { NotifyRulesService } from './notify-rules.service';
import { PanelEventModel } from '../models/api/panel-api.model';

describe('MonitorBootstrapService', () => {
  let store = new FakePreferencesStore();
  const configure = (): void => {
    TestBed.configureTestingModule({
      providers: [
        provideTestTranslate(),
        provideHttpClient(),
        provideHttpClientTesting(),
        providePreferences(store),
      ],
    });
  };

  beforeEach(() => {
    store = new FakePreferencesStore();
    configure();
  });

  it('aplica tamanho do texto e densidade guardados em qualquer página', () => {
    const root = document.documentElement;
    root.classList.remove('text-size-lg', 'density-compact');
    store.data['textSize'] = 'lg';
    store.data['density'] = 'compact';
    try {
      TestBed.inject(MonitorBootstrapService);
      expect(root.classList).toContain('text-size-lg');
      expect(root.classList).toContain('density-compact');
    } finally {
      root.classList.remove('text-size-lg', 'density-compact');
    }
  });

  it('start() dá destino aos avisos, configura as notificações e inicia a consulta', () => {
    const monitor = TestBed.inject(GitlabMonitorService);
    const notifications = TestBed.inject(NotificationsService);
    const sink = vi.spyOn(monitor, 'registerEventSink');
    const setup = vi.spyOn(notifications, 'setup').mockImplementation(() => undefined);
    const start = vi.spyOn(monitor, 'start').mockImplementation(() => undefined);

    TestBed.inject(MonitorBootstrapService).start();

    expect(sink).toHaveBeenCalledOnce();
    expect(setup).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it('registra as colunas do backend na ordem escolhida', async () => {
    TestBed.inject(MonitorBootstrapService);
    const monitor = TestBed.inject(GitlabMonitorService);
    const order = TestBed.inject(ColumnOrderService);
    monitor.setAuthor(['ana.lima']);
    TestBed.inject(HttpTestingController)
      .expectOne((req) => req.url === '/data')
      .flush({
        rows: [],
        collected: true,
        emptyMessage: null,
        columns: [
          { key: 'likes', label: 'Likes', cell: 'likes', weight: 10 },
          { key: 'mr', label: 'MR', cell: 'link', weight: 36 },
        ],
        sorts: [],
        meta: {
          projects: ['g/p'],
          targets: ['g%2Fp'],
          failed: [],
          interval: 15,
          shown: 0,
          total: 0,
          updated: '',
        },
        filters: { authors: [], pipelines: [] },
        error: null,
        events: [],
        sequence: 1,
        updated: '',
        poll: 10,
      });
    await vi.waitFor(() => expect(monitor.columns().length).toBe(2));
    TestBed.tick();

    expect(order.order()).toEqual(['likes', 'mr']);
  });

  it('um ciclo com as mesmas colunas não faz os sinais de coluna emitirem', async () => {
    TestBed.inject(MonitorBootstrapService);
    const monitor = TestBed.inject(GitlabMonitorService);
    const order = TestBed.inject(ColumnOrderService);
    const visibility = TestBed.inject(ColumnVisibilityService);
    const http = TestBed.inject(HttpTestingController);
    const colunas = [
      { key: 'likes', label: 'Likes', cell: 'likes', weight: 10 },
      { key: 'mr', label: 'MR', cell: 'link', weight: 36 },
    ];
    /** Responde o ciclo com uma cópia nova da MESMA lista de colunas. */
    const resposta = async (sequence: number): Promise<void> => {
      http
        .expectOne((req) => req.url === '/data')
        .flush({
          rows: [],
          collected: true,
          emptyMessage: null,
          columns: colunas.map((column) => ({ ...column })),
          sorts: [],
          meta: {
            projects: ['g/p'],
            targets: ['g%2Fp'],
            failed: [],
            interval: 15,
            shown: 0,
            total: 0,
            updated: '',
          },
          filters: { authors: [], pipelines: [] },
          error: null,
          events: [],
          sequence,
          updated: '',
          poll: 10,
        });
      await vi.waitFor(() => expect(monitor.snapshot().sequence).toBe(sequence));
      TestBed.tick();
    };

    monitor.start();
    await resposta(1);

    let ordens = 0;
    let visiveis = 0;
    TestBed.runInInjectionContext(() => {
      effect(() => {
        order.order();
        ordens++;
      });
      effect(() => {
        visibility.visible();
        visiveis++;
      });
    });
    TestBed.tick();
    expect([ordens, visiveis]).toEqual([1, 1]);

    // A consulta seguinte traz as mesmas colunas num array novo: sem a saída
    // antecipada, cada ciclo de dez segundos acordaria presets, tabela e a
    // seção de colunas enquanto alguém a edita.
    monitor.setAuthor(['ana.lima']);
    await resposta(2);

    expect([ordens, visiveis]).toEqual([1, 1]);
  });

  describe('o destino dos eventos', () => {
    const evento = (kind: PanelEventModel['kind']): PanelEventModel => ({
      kind,
      text: `BE #7 ${kind}\nana.lima`,
      mr: '1:7',
      title: 'Ajusta o filtro',
      author: 'ana.lima',
      url: 'https://gitlab.example/mr/7',
      likes: 0,
      mine: true,
      involved: true,
      draft: false,
    });

    const sinkDoPainel = (): ((events: readonly PanelEventModel[]) => boolean) => {
      const monitor = TestBed.inject(GitlabMonitorService);
      const sink = vi.spyOn(monitor, 'registerEventSink');
      vi.spyOn(TestBed.inject(NotificationsService), 'setup').mockImplementation(() => undefined);
      vi.spyOn(monitor, 'start').mockImplementation(() => undefined);
      TestBed.inject(MonitorBootstrapService).start();
      return sink.mock.calls[0][0];
    };

    it('só os eventos que passam pelas regras chegam ao aviso', () => {
      const announce = vi.spyOn(TestBed.inject(NotificationsService), 'announce');
      announce.mockReturnValue(true);
      TestBed.inject(NotifyRulesService).update({
        kinds: {
          opened: true,
          likes: false,
          pipeline: true,
          threads: true,
          left: true,
          review: true,
        },
      });

      const entregue = sinkDoPainel()([evento('likes'), evento('pipeline')]);

      expect(entregue).toBe(true);
      expect(announce.mock.calls[0][0].map((e) => e.kind)).toEqual(['pipeline']);
    });

    it('quando as regras barram tudo, o lote conta como entregue e nada é anunciado', () => {
      // Se devolvesse false, o marcador `since` não avançaria e o servidor
      // reenviaria os mesmos eventos a cada consulta, para sempre.
      const announce = vi.spyOn(TestBed.inject(NotificationsService), 'announce');
      TestBed.inject(NotifyRulesService).update({
        kinds: {
          opened: true,
          likes: false,
          pipeline: true,
          threads: true,
          left: true,
          review: true,
        },
      });

      expect(sinkDoPainel()([evento('likes')])).toBe(true);
      expect(announce).not.toHaveBeenCalled();
    });

    it('lote não entregue volta na consulta seguinte e é avisado, mesmo com espera', () => {
      const announce = vi.spyOn(TestBed.inject(NotificationsService), 'announce');
      announce.mockReturnValueOnce(false).mockReturnValueOnce(true);
      TestBed.inject(NotifyRulesService).update({ cooldownMinutes: 10 });
      const sink = sinkDoPainel();

      expect(sink([evento('pipeline')])).toBe(false);
      expect(sink([evento('pipeline')])).toBe(true);

      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce.mock.calls[1][0].map((e) => e.kind)).toEqual(['pipeline']);
    });

    it('lote entregue inicia a espera: o mesmo MR não avisa de novo logo em seguida', () => {
      const announce = vi.spyOn(TestBed.inject(NotificationsService), 'announce');
      announce.mockReturnValue(true);
      TestBed.inject(NotifyRulesService).update({ cooldownMinutes: 10 });
      const sink = sinkDoPainel();

      sink([evento('pipeline')]);
      sink([evento('likes')]);

      expect(announce).toHaveBeenCalledTimes(1);
    });

    it('se o aviso não pôde ser entregue, o lote continua pendente', () => {
      vi.spyOn(TestBed.inject(NotificationsService), 'announce').mockReturnValue(false);

      expect(sinkDoPainel()([evento('pipeline')])).toBe(false);
    });
  });
});
