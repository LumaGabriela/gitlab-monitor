import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { FakePreferencesStore, providePreferences } from '../../../../../testing/preferences';
import { provideTestTranslate } from '../../../../../testing/translate';
import {
  COLLECTING_HINT_MS,
  GitlabMonitorService,
} from '../../../../core/services/gitlab-monitor.service';
import { IconComponent } from '../../../../shared/ui/icon/icon.component';
import { PanelSnapshotModel } from '../../../../core/models/api/panel-api.model';
import { formatDate, formatRelative, formatTime } from '../../../../shared/monitor/cell-format';
import { MonitorPage } from './monitor.page';

const TWO_MINUTES_MS = 2 * 60 * 1000;

function snapshot(overrides: Partial<PanelSnapshotModel>): PanelSnapshotModel {
  const updated = new Date(Date.now() - TWO_MINUTES_MS).toISOString();
  return {
    rows: [],
    collected: true,
    emptyMessage: null,
    columns: [],
    sorts: [],
    meta: {
      projects: ['groups/flake/siga'],
      targets: ['groups/flake%2Fsiga'],
      failed: [],
      interval: 15,
      shown: 0,
      total: 0,
      updated,
    },
    filters: { authors: [], pipelines: [] },
    error: null,
    events: [],
    sequence: 1,
    updated,
    poll: 10,
    ...overrides,
  };
}

describe('MonitorPage — linha de estado', () => {
  let fixture: ComponentFixture<MonitorPage>;
  let http: HttpTestingController;

  /** Avança o relógio falso e redesenha; com 0, só resolve os microtasks. */
  const tick = async (ms = 0): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
  };
  const settle = (): Promise<void> => tick();
  const status = (): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.ui-status-line')!;

  const open = async (data: PanelSnapshotModel | null): Promise<void> => {
    fixture = TestBed.createComponent(MonitorPage);
    fixture.detectChanges();
    const request = http.expectOne((req) => req.url === '/data');
    if (data) request.flush(data);
    await settle();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      imports: [MonitorPage],
      providers: [
        provideTestTranslate(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        providePreferences(new FakePreferencesStore()),
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra o alvo e o tempo relativo da última coleta', async () => {
    const data = snapshot({});
    await open(data);
    const expected = formatRelative(data.meta.updated!, 'pt');

    expect(expected).not.toBe('');
    expect(status().textContent).toContain('groups/flake/siga');
    expect(status().textContent).toContain(expected);
    expect(status().className).toContain('ui-status-line--ok');
  });

  it('guarda a data e a hora completas no title do tempo relativo', async () => {
    const data = snapshot({});
    await open(data);
    const full = `${formatDate(data.meta.updated!, 'pt')} ${formatTime(data.meta.updated!, 'pt')}`;

    expect(status().querySelector(`[title="${full}"]`)).not.toBeNull();
  });

  it('troca o tempo relativo ao trocar de idioma', async () => {
    const data = snapshot({});
    await open(data);
    TestBed.inject(TranslateService).use('en');
    await settle();

    expect(status().textContent).toContain(formatRelative(data.meta.updated!, 'en'));
  });

  it('marca a linha de estado como erro quando a coleta falhou', async () => {
    await open(snapshot({ error: 'Falha ao consultar o GitLab' }));

    expect(status().className).toContain('ui-status-line--error');
  });

  it('marca a linha de estado como carregando antes da primeira coleta', async () => {
    await open(
      snapshot({
        collected: false,
        meta: {
          projects: ['groups/flake/siga'],
          targets: ['groups/flake%2Fsiga'],
          failed: [],
          interval: 15,
          shown: 0,
          total: 0,
          updated: null,
        },
      }),
    );

    expect(status().className).toContain('ui-status-line--loading');
    expect(status().textContent).toContain('groups/flake/siga');
  });

  // O estado "coletando" tem de nascer do ciclo que a própria rota roda: a
  // consulta manual mora na página de notificações, e só ela o produzia.
  /** Deixa o ciclo de dez segundos disparar e devolve a consulta em aberto. */
  const cicloEmAndamento = async (): Promise<TestRequest> => {
    await tick(10_000);
    return http.expectOne((req) => req.url === '/data');
  };
  const statusIcon = (): IconComponent =>
    fixture.debugElement.query(By.css('.ui-status-line')).query(By.directive(IconComponent))
      .componentInstance as IconComponent;

  it('o ciclo rápido não pisca o ícone de coleta', async () => {
    await open(snapshot({}));
    const request = await cicloEmAndamento();

    // Abaixo do limiar a faixa não muda: a resposta chega antes.
    await tick(COLLECTING_HINT_MS - 1);
    expect(status().className).toContain('ui-status-line--ok');
    expect(statusIcon().name()).toBe('check');

    request.flush(snapshot({}));
    await tick(COLLECTING_HINT_MS * 2);
    expect(status().className).toContain('ui-status-line--ok');
  });

  it('a coleta do ciclo que passa do limiar vira carregando, com o ícone refresh', async () => {
    await open(snapshot({}));
    const request = await cicloEmAndamento();

    await tick(COLLECTING_HINT_MS);
    expect(status().className).toContain('ui-status-line--loading');
    expect(status().className).not.toContain('ui-status-line--ok');
    expect(statusIcon().name()).toBe('refresh');

    request.flush(snapshot({}));
    await tick();
    expect(status().className).toContain('ui-status-line--ok');
  });

  it('o erro vence a coleta em andamento', async () => {
    await open(snapshot({ error: 'Falha ao consultar o GitLab' }));
    const request = await cicloEmAndamento();
    await tick(COLLECTING_HINT_MS);

    expect(TestBed.inject(GitlabMonitorService).collecting()).toBe(true);
    expect(status().className).toContain('ui-status-line--error');
    expect(status().className).not.toContain('ui-status-line--loading');

    request.flush(snapshot({ error: 'Falha ao consultar o GitLab' }));
  });

  it('a região viva cobre o alvo e o estado, e deixa o tempo relativo de fora', async () => {
    const data = snapshot({});
    await open(data);
    const relativo = formatRelative(data.meta.updated!, 'pt');
    const viva = status().querySelectorAll('[aria-live]');

    // Uma só região viva na faixa, e nela nada que mude de minuto em minuto:
    // o tempo relativo seria reanunciado para sempre.
    expect(viva).toHaveLength(1);
    expect(status().getAttribute('aria-live')).toBeNull();
    expect(viva[0].textContent).toContain('groups/flake/siga');
    expect(viva[0].textContent).not.toContain(relativo);
    expect(status().textContent).toContain(relativo);
  });

  it('o recipiente do aviso fica no DOM mesmo sem aviso', async () => {
    await open(snapshot({}));
    const alerta = (fixture.nativeElement as HTMLElement).querySelector('app-alert')!;

    // Uma região viva criada junto com o texto não anuncia: ela precisa já
    // existir quando a mensagem chega.
    expect(alerta).not.toBeNull();
    expect(alerta.getAttribute('role')).toBe('status');
    expect(alerta.textContent?.trim()).toBe('');
    expect(alerta.className).toContain('ui-monitor-alert--quiet');
  });

  it('o aviso diz a mensagem do backend, e a faixa não a chama de falha na coleta', async () => {
    await open(snapshot({ error: 'Falha ao consultar o GitLab' }));
    const alerta = (fixture.nativeElement as HTMLElement).querySelector('app-alert')!;

    expect(alerta.textContent).toContain('Falha ao consultar o GitLab');
    expect(alerta.className).not.toContain('ui-monitor-alert--quiet');
    // O detalhe é do aviso; a faixa só aponta para ele, em vez de chamar todo
    // aviso de falha de coleta.
    expect(status().textContent).toContain('Veja o aviso abaixo');
    expect(status().textContent).not.toContain('Falha ao consultar o GitLab');
  });

  it.each([
    ['pt', 'agora mesmo'],
    ['en', 'just now'],
  ])('coleta com menos de um minuto diz o texto do catálogo em %s', async (lang, texto) => {
    const updated = new Date(Date.now() - 10_000).toISOString();
    await open(
      snapshot({
        meta: {
          projects: ['groups/flake/siga'],
          targets: ['groups/flake%2Fsiga'],
          failed: [],
          interval: 15,
          shown: 0,
          total: 0,
          updated,
        },
      }),
    );
    TestBed.inject(TranslateService).use(lang);
    await settle();

    expect(status().textContent).toContain(texto);
    expect(status().textContent).not.toContain('monitor.just-now');
  });

  // O backend carimba `updated` depois de um scan vazio, então "nenhum alvo" e
  // "nenhum MR aberto" chegam iguais em /data: quem distingue é meta.projects.
  describe('sem nenhum alvo escolhido', () => {
    const noTargets = (): PanelSnapshotModel =>
      snapshot({
        meta: {
          projects: [],
          targets: [],
          failed: [],
          interval: 15,
          shown: 0,
          total: 0,
          updated: new Date().toISOString(),
        },
      });
    const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

    it('diz que falta escolher e aponta para a aba Consulta', async () => {
      await open(noTargets());

      const link = host().querySelector<HTMLAnchorElement>('app-empty-state a');
      expect(host().querySelector('app-empty-state')?.textContent).toContain(
        'Nenhum projeto escolhido',
      );
      expect(link?.getAttribute('href')).toBe('/settings/query');
      expect(host().querySelector('app-mr-table')).toBeNull();
    });

    it('não é tratado como erro', async () => {
      await open(noTargets());

      expect(status().className).not.toContain('ui-status-line--error');
    });

    it('com alvo e sem MR, mantém a tabela e o texto de alvo vazio', async () => {
      await open(snapshot({ emptyMessage: { key: 'empty-target', label: 'vazio' } }));

      expect(host().querySelector('app-empty-state')).toBeNull();
      expect(host().querySelector('app-mr-table')).not.toBeNull();
    });

    it('antes da primeira resposta não afirma que falta escolher', async () => {
      await open(null);

      expect(host().querySelector('app-empty-state')).toBeNull();
    });

    it('a faixa não diz "Alvos:" vazio: diz que nenhum foi escolhido', async () => {
      await open(noTargets());

      expect(status().textContent).toContain('Nenhum alvo escolhido');
      expect(status().textContent).not.toContain('Alvos:');
    });

    it('antes da primeira resposta a faixa não nomeia alvo nenhum', async () => {
      await open(null);

      expect(status().textContent).not.toContain('Alvos:');
      expect(status().textContent).not.toContain('Nenhum alvo escolhido');
    });
  });

  describe('falha parcial de alvo', () => {
    const host = (): HTMLElement => fixture.nativeElement as HTMLElement;

    it('nomeia os alvos que ficaram de fora, no idioma ativo', async () => {
      await open(
        snapshot({
          meta: {
            projects: ['g/p', 'groups/g'],
            targets: ['g%2Fp', 'groups/g'],
            failed: ['groups/g'],
            interval: 15,
            shown: 0,
            total: 0,
            updated: new Date().toISOString(),
          },
        }),
      );

      const aviso = host().querySelector('.ui-monitor-alert');
      expect(aviso?.textContent).toContain('groups/g');
      expect(aviso?.textContent).not.toContain('monitor.partial-failure');
      // Coleta incompleta não é "ok": a faixa não pode ficar verde.
      expect(status().className).toContain('ui-status-line--error');
    });
  });
});
