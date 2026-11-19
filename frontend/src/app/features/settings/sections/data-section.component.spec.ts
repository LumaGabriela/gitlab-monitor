import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';
import { PREFERENCES_MAX_BYTES } from '../../../core/models/api/preferences-api.model';
import { DataSectionComponent, PAGE_RELOAD } from './data-section.component';

const IMPORTED = {
  app: 'gitlab-monitor',
  version: 1,
  exportedAt: '2026-11-17T12:00:00.000Z',
  preferences: { theme: 'dark', rowRules: [{}, {}], notifyRules: 'lixo', presets: [{}] },
};

function fileOf(text: string): File {
  return new File([text], 'prefs.json', { type: 'application/json' });
}

describe('DataSectionComponent', () => {
  let fixture: ComponentFixture<DataSectionComponent>;
  let store: FakePreferencesStore & { replace: ReturnType<typeof vi.fn> };
  let reload: ReturnType<typeof vi.fn>;
  const host = (): HTMLElement => fixture.nativeElement;
  const buttons = (): HTMLButtonElement[] => [...host().querySelectorAll('button')];
  const button = (text: string): HTMLButtonElement | undefined =>
    buttons().find((b) => b.textContent?.includes(text));
  const alerts = (): string => host().querySelector('[data-test="data-result"]')?.textContent ?? '';

  async function pick(file: File): Promise<void> {
    const input = host().querySelector<HTMLInputElement>('input[type="file"]')!;
    // O jsdom não tem DataTransfer: a lista de arquivos é fornecida à mão.
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: { length: 1, item: (): File => file },
    });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    store = Object.assign(new FakePreferencesStore({ theme: 'light' }), {
      replace: vi.fn().mockResolvedValue(undefined),
    });
    reload = vi.fn();
    await TestBed.configureTestingModule({
      imports: [DataSectionComponent],
      providers: [
        provideTestTranslate(),
        providePreferences(store),
        { provide: PAGE_RELOAD, useValue: reload },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DataSectionComponent);
    fixture.detectChanges();
  });

  it('é a seção "dados", com o título como alvo de foco', () => {
    expect(host().querySelector('section')?.id).toBe('dados');
    const h2 = host().querySelector('h2');
    expect(h2?.hasAttribute('data-focus-target')).toBe(true);
    expect(h2?.getAttribute('tabindex')).toBe('-1');
  });

  it('mostra onde os dados ficam', () => {
    expect(host().textContent).toContain('user-data/preferences.json');
  });

  it('sem resposta do backend, diz que o local é desconhecido', () => {
    TestBed.resetTestingModule();
    const unknown = new FakePreferencesStore();
    Object.defineProperty(unknown, 'file', { value: () => null });
    TestBed.configureTestingModule({
      imports: [DataSectionComponent],
      providers: [provideTestTranslate(), providePreferences(unknown)],
    });
    const f = TestBed.createComponent(DataSectionComponent);
    f.detectChanges();
    expect(f.nativeElement.textContent).not.toContain('user-data/preferences.json');
    expect(f.nativeElement.textContent).not.toContain('preferences.file-');
  });

  it('com o arquivo conhecido, Exportar está habilitado e sem aviso', () => {
    expect(button('Exportar')!.disabled).toBe(false);
    expect(host().querySelector('[data-test="data-export-unavailable"]')).toBeNull();
  });

  it('sem leitura inicial (arquivo desconhecido), Exportar fica desabilitado e diz por quê', () => {
    TestBed.resetTestingModule();
    const unknown = new FakePreferencesStore();
    Object.defineProperty(unknown, 'file', { value: () => null });
    TestBed.configureTestingModule({
      imports: [DataSectionComponent],
      providers: [provideTestTranslate(), providePreferences(unknown)],
    });
    const f = TestBed.createComponent(DataSectionComponent);
    f.detectChanges();
    const exportButton = f.nativeElement.querySelector('[data-test="data-export"]');
    expect(exportButton.disabled).toBe(true);
    expect(
      f.nativeElement.querySelector('[data-test="data-export-unavailable"]')?.textContent,
    ).toContain('Não foi possível ler as preferências');
  });

  it('exportar baixa o snapshot do store', async () => {
    const create = vi.fn().mockReturnValue('blob:x');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      button('Exportar')!.click();

      expect(create).toHaveBeenCalledTimes(1);
      const blob = create.mock.calls[0][0] as Blob;
      expect(blob.type).toContain('application/json');
      expect(click).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith('blob:x');
      const body = JSON.parse(await blob.text()) as Record<string, unknown>;
      expect(body['app']).toBe('gitlab-monitor');
      expect(body['preferences']).toEqual({ theme: 'light' });
    } finally {
      vi.unstubAllGlobals();
      click.mockRestore();
    }
  });

  it('arquivo maior que o teto é recusado antes de ser lido', async () => {
    const file = fileOf('{}');
    Object.defineProperty(file, 'size', { value: PREFERENCES_MAX_BYTES + 1 });
    const text = vi.spyOn(file, 'text');

    await pick(file);

    expect(text).not.toHaveBeenCalled();
    expect(alerts()).toContain('maior');
    expect(button('Substituir')).toBeUndefined();
  });

  it('arquivo que não serve mostra o erro traduzido e não pede confirmação', async () => {
    await pick(fileOf('{quebrado'));

    expect(alerts()).not.toContain('preferences.import-error');
    expect(alerts().length).toBeGreaterThan(0);
    expect(button('Substituir')).toBeUndefined();
    expect(store.replace).not.toHaveBeenCalled();
  });

  it('importar pede confirmação, com o resumo, e só substitui ao confirmar', async () => {
    await pick(fileOf(JSON.stringify(IMPORTED)));

    expect(store.replace).not.toHaveBeenCalled();
    const summary = host().querySelector('[data-test="import-summary"]')?.textContent ?? '';
    // 2 regras de destaque, 0 de notificação (valor que não é lista), 1 preset.
    expect(summary).toMatch(/2/);
    expect(summary).toMatch(/1/);
    expect(summary).toContain('substitui');

    button('Substituir')!.click();
    await fixture.whenStable();

    expect(store.replace).toHaveBeenCalledTimes(1);
    expect(store.replace.mock.calls[0][0]).toEqual({
      version: 1,
      preferences: IMPORTED.preferences,
    });
  });

  it('cancelar descarta o arquivo sem substituir', async () => {
    await pick(fileOf(JSON.stringify(IMPORTED)));
    button('Cancelar')!.click();
    fixture.detectChanges();

    expect(store.replace).not.toHaveBeenCalled();
    expect(button('Substituir')).toBeUndefined();
  });

  it('confirmar substitui e recarrega', async () => {
    await pick(fileOf(JSON.stringify(IMPORTED)));
    button('Substituir')!.click();
    await fixture.whenStable();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('falha ao substituir mostra erro e não recarrega', async () => {
    store.replace.mockRejectedValue(new Error('500'));
    await pick(fileOf(JSON.stringify(IMPORTED)));
    button('Substituir')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(reload).not.toHaveBeenCalled();
    expect(alerts().length).toBeGreaterThan(0);
  });
});
