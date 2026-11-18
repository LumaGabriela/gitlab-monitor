import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { FakePreferencesStore, providePreferences } from '../../../../../testing/preferences';
import { provideTestTranslate } from '../../../../../testing/translate';
import { APP_ROUTES } from '../../../../app.routes';
import { MonitorBootstrapService } from '../../../../core/services/monitor-bootstrap.service';

describe('SettingsPage (casca das configurações)', () => {
  let harness: RouterTestingHarness;
  let start: ReturnType<typeof vi.fn>;
  const host = (): HTMLElement => harness.routeNativeElement as HTMLElement;
  const sectionIds = (): string[] => [...host().querySelectorAll('section[id]')].map((s) => s.id);

  beforeEach(async () => {
    start = vi.fn();
    await TestBed.configureTestingModule({
      providers: [
        provideTestTranslate(),
        provideRouter(APP_ROUTES),
        provideHttpClient(),
        provideHttpClientTesting(),
        providePreferences(new FakePreferencesStore()),
        { provide: MonitorBootstrapService, useValue: { start } },
      ],
    }).compileComponents();
    harness = await RouterTestingHarness.create();
  });

  it('a raiz /settings cai na primeira seção, com o título da página', async () => {
    await harness.navigateByUrl('/settings');

    expect(host().querySelector('h1')?.textContent).toContain('Configurações');
    expect(sectionIds()).toEqual(['consulta']);
  });

  it('não abre modal: as configurações são páginas', async () => {
    await harness.navigateByUrl('/settings');

    expect(host().querySelector('[role="dialog"]')).toBeNull();
  });

  it('cada caminho mostra uma seção só', async () => {
    const esperado: Record<string, string> = {
      query: 'consulta',
      notifications: 'notificacoes',
      display: 'exibicao',
      columns: 'colunas',
      highlights: 'destaques',
      presets: 'predefinicoes',
      data: 'dados',
    };
    for (const [path, id] of Object.entries(esperado)) {
      await harness.navigateByUrl(`/settings/${path}`);
      expect(sectionIds()).toEqual([id]);
    }
  });

  it('não tem navegação lateral própria e traz as ferramentas no cabeçalho', async () => {
    await harness.navigateByUrl('/settings');

    expect(host().querySelector('.ui-settings-nav')).toBeNull();
    expect(host().querySelector('.ui-page-header app-page-tools')).not.toBeNull();
  });

  it('mantém o monitor de pé ao trocar de seção: start() uma vez só', async () => {
    await harness.navigateByUrl('/settings');
    await harness.navigateByUrl('/settings/query');
    await harness.navigateByUrl('/settings/columns');
    await harness.navigateByUrl('/settings/display');

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('caminho de seção que não existe volta ao painel', async () => {
    await harness.navigateByUrl('/settings/nao-existe');

    expect(TestBed.inject(Router).url).toBe('/');
  });
});
