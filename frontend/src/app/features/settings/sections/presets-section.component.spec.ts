import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';
import { Preset, PresetsService } from '../../../core/services/presets.service';
import { PresetsSectionComponent } from './presets-section.component';

const SAVED: Preset = {
  id: 'p1',
  name: 'Minha visão',
  filters: { sort: 'recent', direction: null, author: [], pipeline: [], review: [] },
  columnOrder: null,
  hiddenColumns: null,
  rowRules: [],
  notifyRules: null,
};

describe('PresetsSectionComponent', () => {
  let fixture: ComponentFixture<PresetsSectionComponent>;
  let service: PresetsService;
  const host = (): HTMLElement => fixture.nativeElement;
  const items = (): HTMLElement[] => [...host().querySelectorAll<HTMLElement>('[data-preset]')];
  const status = (): string => host().querySelector('[role="status"]')?.textContent?.trim() ?? '';

  beforeEach(async () => {
    vi.useFakeTimers();
    const store = new FakePreferencesStore({ presets: [SAVED] });
    await TestBed.configureTestingModule({
      imports: [PresetsSectionComponent],
      providers: [
        provideTestTranslate(),
        provideHttpClient(),
        provideHttpClientTesting(),
        providePreferences(store),
      ],
    }).compileComponents();
    service = TestBed.inject(PresetsService);
    fixture = TestBed.createComponent(PresetsSectionComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('o título é o único alvo de foco, e a seção tem id em português', () => {
    expect(host().querySelectorAll('[data-focus-target]').length).toBe(1);
    expect(host().querySelector('h2[data-focus-target]')?.textContent?.trim()).toBe('Presets');
    expect(host().querySelector('section')?.id).toBe('predefinicoes');
  });

  it('lista os prontos com o nome traduzido, sem renomear nem remover', () => {
    expect(items().length).toBe(4);
    expect(items()[0].textContent).toContain('Preciso revisar');
    expect(items()[0].querySelector('[data-test="preset-remove"]')).toBeNull();
    expect(items()[0].querySelector('input')).toBeNull();
    expect(items()[0].textContent).toContain('Preset pronto');
  });

  it('o preset guardado mostra o nome num campo e um botão de remover', () => {
    const campo = items()[3].querySelector<HTMLInputElement>('input')!;
    expect(campo.value).toBe('Minha visão');
    expect(items()[3].querySelector('[data-test="preset-remove"]')).not.toBeNull();
  });

  it('salvar o atual cria o preset, limpa o campo e anuncia', () => {
    const save = vi.spyOn(service, 'saveCurrent');
    const nome = host().querySelector<HTMLInputElement>('[data-test="preset-name"] input')!;
    nome.value = 'Outra';
    nome.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    host().querySelector<HTMLButtonElement>('[data-test="preset-save"]')!.click();
    vi.advanceTimersByTime(100);
    fixture.detectChanges();

    expect(save).toHaveBeenCalledWith('Outra');
    expect(status()).toBe('Preset salvo.');
    expect(host().querySelector<HTMLInputElement>('[data-test="preset-name"] input')!.value).toBe(
      '',
    );
  });

  it('sem nome o botão de salvar fica desabilitado', () => {
    expect(host().querySelector<HTMLButtonElement>('[data-test="preset-save"]')!.disabled).toBe(
      true,
    );
  });

  it('renomear e remover passam pelo serviço', () => {
    const rename = vi.spyOn(service, 'rename');
    const remove = vi.spyOn(service, 'remove');
    const campo = items()[3].querySelector<HTMLInputElement>('input')!;
    campo.value = 'Novo nome';
    campo.dispatchEvent(new Event('input'));
    expect(rename).toHaveBeenCalledWith('p1', 'Novo nome');

    items()[3].querySelector<HTMLButtonElement>('[data-test="preset-remove"]')!.click();
    expect(remove).toHaveBeenCalledWith('p1');
  });

  it('aplicar chama o serviço com o id do preset', () => {
    const apply = vi.spyOn(service, 'apply');
    items()[0].querySelector<HTMLButtonElement>('[data-test="preset-apply"]')!.click();
    expect(apply).toHaveBeenCalledWith('need-review');
  });
});
