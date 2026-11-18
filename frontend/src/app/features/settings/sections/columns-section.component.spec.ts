import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ColumnModel } from '../../../core/models/api/panel-api.model';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';
import { ColumnOrderService } from '../../../core/services/column-order.service';
import { ColumnVisibilityService } from '../../../core/services/column-visibility.service';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { ColumnsSectionComponent } from './columns-section.component';

describe('ColumnsSectionComponent', () => {
  let fixture: ComponentFixture<ColumnsSectionComponent>;
  const host = (): HTMLElement => fixture.nativeElement;
  const colunas = (): HTMLInputElement[] => [
    ...host().querySelectorAll<HTMLInputElement>('.ui-settings__columns input'),
  ];

  const botao = (label: string, linha: number): HTMLButtonElement => {
    const linhas = host().querySelectorAll<HTMLElement>('.ui-settings__column');
    return linhas[linha].querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  };

  const COLUNAS: readonly ColumnModel[] = [
    { key: 'mr', label: 'MR', cell: 'link', weight: 36 },
    { key: 'author', label: 'Autor', cell: 'text', weight: 18 },
  ];

  let store = new FakePreferencesStore();

  beforeEach(async () => {
    store = new FakePreferencesStore();
    await TestBed.configureTestingModule({
      imports: [ColumnsSectionComponent],
      providers: [
        provideTestTranslate(),
        provideHttpClient(),
        provideHttpClientTesting(),
        providePreferences(store),
        {
          provide: GitlabMonitorService,
          useValue: { columns: signal(COLUNAS) } as unknown as GitlabMonitorService,
        },
      ],
    }).compileComponents();
    const keys = COLUNAS.map((c) => c.key);
    TestBed.inject(ColumnOrderService).registerColumns(keys);
    TestBed.inject(ColumnVisibilityService).registerColumns(keys);
    fixture = TestBed.createComponent(ColumnsSectionComponent);
    fixture.detectChanges();
  });

  it('uma caixa por coluna, todas marcadas quando nada está oculto', () => {
    expect(colunas().length).toBe(2);
    expect(host().querySelector('.ui-settings__columns')?.textContent).toContain('Autor');
    expect(colunas().every((c) => c.checked)).toBe(true);
  });

  it('a coluna oculta aparece desmarcada', () => {
    TestBed.inject(ColumnVisibilityService).setHidden('author', true);
    fixture.detectChanges();

    expect(colunas().map((c) => c.checked)).toEqual([true, false]);
  });

  it('desmarcar uma coluna pede para escondê-la', () => {
    colunas()[1].click();

    expect(TestBed.inject(ColumnVisibilityService).hidden()).toEqual(['author']);
  });

  it('cada coluna tem botões de mover, desabilitados nas pontas', () => {
    expect(botao('Mover MR para cima', 0).disabled).toBe(true);
    expect(botao('Mover MR para baixo', 0).disabled).toBe(false);
    expect(botao('Mover Autor para cima', 1).disabled).toBe(false);
    expect(botao('Mover Autor para baixo', 1).disabled).toBe(true);
  });

  it('mover para cima troca a coluna com a vizinha', () => {
    botao('Mover Autor para cima', 1).click();

    expect(TestBed.inject(ColumnOrderService).order()).toEqual(['author', 'mr']);
  });

  it('anuncia a nova posição depois de mover', () => {
    botao('Mover MR para baixo', 0).click();
    fixture.detectChanges();

    const status = host().querySelector('[role="status"]');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.textContent).toContain('MR agora é a coluna 2 de 2');
  });

  it('restaurar a ordem volta à que o backend informa', () => {
    botao('Mover Autor para cima', 1).click();

    host().querySelector<HTMLButtonElement>('[data-test="reset-order"]')!.click();

    expect(TestBed.inject(ColumnOrderService).order()).toEqual(['mr', 'author']);
  });
});
