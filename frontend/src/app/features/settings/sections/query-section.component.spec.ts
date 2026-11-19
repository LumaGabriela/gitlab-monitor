import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTestTranslate } from '../../../../testing/translate';
import { AvailableTargetModel, PanelMetaModel } from '../../../core/models/api/panel-api.model';
import {
  GitlabMonitorService,
  MAX_TARGETS,
  MonitorWarning,
} from '../../../core/services/gitlab-monitor.service';
import { QuerySectionComponent } from './query-section.component';

const TARGETS: readonly AvailableTargetModel[] = [
  { value: 'groups/flake', label: 'flake', kind: 'group' },
  { value: 'groups/flake/siga', label: 'flake/siga', kind: 'project' },
  { value: 'groups/flake/outro', label: 'flake/outro', kind: 'project' },
];

describe('QuerySectionComponent', () => {
  let fixture: ComponentFixture<QuerySectionComponent>;
  let targets: WritableSignal<readonly string[]>;
  let meta: WritableSignal<PanelMetaModel>;
  let saving: WritableSignal<boolean>;
  const saveSettings = vi.fn(async (): Promise<MonitorWarning | null> => null);
  const host = (): HTMLElement => fixture.nativeElement;
  const submit = (): HTMLButtonElement =>
    host().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const openPanel = (): void => {
    host().querySelector<HTMLButtonElement>('.ui-multi-select__trigger')!.click();
    fixture.detectChanges();
  };
  const checkboxes = (): HTMLInputElement[] => [
    ...host().querySelectorAll<HTMLInputElement>('.ui-multi-select__panel input[type="checkbox"]'),
  ];
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const create = async (load: () => Promise<readonly AvailableTargetModel[]>): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [QuerySectionComponent],
      providers: [
        provideTestTranslate(),
        {
          provide: GitlabMonitorService,
          useValue: {
            targets,
            meta,
            saving,
            saveSettings,
            loadTargets: vi.fn(load),
          } as unknown as GitlabMonitorService,
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(QuerySectionComponent);
    fixture.detectChanges();
    await settle();
  };

  beforeEach(() => {
    targets = signal<readonly string[]>(['groups/flake/siga']);
    meta = signal<PanelMetaModel>({
      projects: ['flake/siga'],
      targets: ['groups/flake%2Fsiga'],
      failed: [],
      interval: 15,
      shown: 0,
      total: 0,
      updated: null,
    });
    saving = signal<boolean>(false);
    saveSettings.mockClear();
  });

  it('marca os alvos já monitorados ao abrir', async () => {
    await create(async () => TARGETS);
    openPanel();

    expect(checkboxes().map((c) => c.checked)).toEqual([false, true, false]);
  });

  it('salva os alvos marcados e o intervalo', async () => {
    await create(async () => TARGETS);
    openPanel();
    checkboxes()[2].click();
    fixture.detectChanges();

    host().querySelector('form')?.dispatchEvent(new Event('submit'));

    expect(saveSettings).toHaveBeenCalledWith(['groups/flake/siga', 'groups/flake/outro'], '15');
  });

  it('mostra erro quando a lista não carrega, sem dizer que não há projetos', async () => {
    await create(async () => {
      throw new Error('falhou');
    });

    expect(host().querySelector('.ui-alert--danger')?.textContent).toContain('Não foi possível');
    expect(host().querySelector('app-empty-state')).toBeNull();
  });

  it('mostra o estado vazio quando a lista carrega sem nenhum item', async () => {
    await create(async () => []);

    expect(host().querySelector('app-empty-state')).not.toBeNull();
    expect(host().textContent).not.toContain('Não foi possível');
  });

  it('desabilita Salvar com nenhum alvo marcado', async () => {
    targets.set([]);
    await create(async () => TARGETS);

    expect(submit().disabled).toBe(true);

    openPanel();
    checkboxes()[0].click();
    fixture.detectChanges();

    expect(submit().disabled).toBe(false);
  });

  it('o que está sendo marcado sobrevive a um novo ciclo de consulta', async () => {
    await create(async () => TARGETS);
    openPanel();
    checkboxes()[2].click();
    fixture.detectChanges();

    targets.set(['groups/flake/siga']);
    fixture.detectChanges();

    expect(checkboxes().map((c) => c.checked)).toEqual([false, true, true]);
  });

  it('desmarcar tudo sobrevive a um novo ciclo de consulta', async () => {
    // É a propriedade que justifica a flag `edited`: sem ela, a lista vazia
    // deixada de propósito voltaria a ser a do monitor na resposta seguinte.
    await create(async () => TARGETS);
    openPanel();
    checkboxes()[1].click();
    fixture.detectChanges();
    expect(checkboxes().every((c) => !c.checked)).toBe(true);

    targets.set(['groups/flake/siga']);
    fixture.detectChanges();

    expect(checkboxes().every((c) => !c.checked)).toBe(true);
    expect(submit().disabled).toBe(true);
  });

  it('acima do teto do backend, avisa e não deixa salvar', async () => {
    const muitos: readonly AvailableTargetModel[] = Array.from(
      { length: MAX_TARGETS + 1 },
      (_, n): AvailableTargetModel => ({
        value: `grupo%2Fp${n}`,
        label: `grupo/p${n}`,
        kind: 'project',
      }),
    );
    targets.set(muitos.map((item) => item.value));
    await create(async () => muitos);

    expect(host().querySelector('.ui-alert--danger')?.textContent).toContain(String(MAX_TARGETS));
    expect(submit().disabled).toBe(true);

    openPanel();
    checkboxes()[0].click();
    fixture.detectChanges();

    expect(host().querySelector('.ui-alert--danger')).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('a recusa do backend aparece aqui, traduzida pelo catálogo', async () => {
    saveSettings.mockResolvedValueOnce({
      key: 'settings.error-too-many-targets',
      text: 'Choose at most 20 projects or groups.',
    });
    await create(async () => TARGETS);

    host().querySelector('form')?.dispatchEvent(new Event('submit'));
    await settle();

    const aviso = host().querySelector('.ui-alert--danger')?.textContent ?? '';
    expect(aviso).toContain('20');
    expect(aviso).not.toContain('Choose at most');
    expect(aviso).not.toContain('settings.error-');
  });

  it('salvando, o botão anuncia que está ocupado', async () => {
    await create(async () => TARGETS);
    saving.set(true);
    fixture.detectChanges();

    expect(submit().getAttribute('aria-busy')).toBe('true');
  });
});
