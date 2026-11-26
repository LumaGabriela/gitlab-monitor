import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTestTranslate } from '../../../../testing/translate';
import { MonitorToolbarComponent } from './monitor-toolbar.component';

describe('MonitorToolbarComponent, seletor de preset', () => {
  let fixture: ComponentFixture<MonitorToolbarComponent>;
  const gatilho = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('[data-test="preset-select"] [role="combobox"]');

  async function choose(label: string): Promise<void> {
    gatilho().click();
    fixture.detectChanges();
    await fixture.whenStable();
    const opcao = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent?.trim() === label,
    );
    opcao?.click();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonitorToolbarComponent],
      providers: [provideTestTranslate()],
    }).compileComponents();
    fixture = TestBed.createComponent(MonitorToolbarComponent);
    fixture.componentRef.setInput('presets', [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ]);
    fixture.componentRef.setInput('activePreset', 'a');
    fixture.detectChanges();
  });

  it('mostra o preset ativo e volta a "nenhum" quando deixa de haver um', async () => {
    expect(gatilho().textContent?.trim()).toBe('A');

    fixture.componentRef.setInput('activePreset', '');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(gatilho().textContent?.trim()).toBe('Nenhum preset');
  });

  it('escolher emite o id, e se nada passa a corresponder o select não afirma a escolha', async () => {
    const emitted: string[] = [];
    fixture.componentInstance.presetChange.subscribe((id: string) => emitted.push(id));
    fixture.componentRef.setInput('activePreset', '');
    fixture.detectChanges();

    await choose('B');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(emitted).toEqual(['b']);
    expect(gatilho().textContent?.trim()).toBe('Nenhum preset');
  });

  it('escolher um preset que não casa por inteiro emite só a escolha, sem reaplicar o anterior', async () => {
    const emitted: string[] = [];
    fixture.componentInstance.presetChange.subscribe((id: string) => emitted.push(id));
    // Ativo "a": escolher "b" não muda o ativo (b aplicado só em parte).
    await choose('B');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(emitted).toEqual(['b']);
    expect(gatilho().textContent?.trim()).toBe('A');
  });

  it('escolher "Nenhum preset" pede para limpar, sem aplicar preset nenhum', async () => {
    const emitted: string[] = [];
    let cleared = 0;
    fixture.componentInstance.presetChange.subscribe((id: string) => emitted.push(id));
    fixture.componentInstance.clearFilters.subscribe(() => (cleared += 1));

    await choose('Nenhum preset');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cleared).toBe(1);
    expect(emitted).toEqual([]);
  });

  it('devolver o select ao ativo não dispara o limpar', async () => {
    let cleared = 0;
    fixture.componentInstance.clearFilters.subscribe(() => (cleared += 1));
    fixture.componentRef.setInput('activePreset', '');
    fixture.detectChanges();

    // "b" não passa a ser o ativo: o select volta sozinho para vazio, e esse
    // retorno não é uma escolha de quem olha.
    await choose('B');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(cleared).toBe(0);
  });

  it('depois de devolvido ao ativo, escolher o mesmo preset outra vez ainda aplica', async () => {
    const emitted: string[] = [];
    fixture.componentInstance.presetChange.subscribe((id: string) => emitted.push(id));
    for (let i = 0; i < 2; i++) {
      await choose('B');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();
    }
    expect(emitted).toEqual(['b', 'b']);
  });
});
