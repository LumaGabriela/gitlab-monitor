import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilePickerComponent } from './file-picker.component';

@Component({
  imports: [FilePickerComponent],
  template: `<app-file-picker
    label="Escolher"
    accept=".json"
    [disabled]="disabled()"
    (fileSelected)="picked.push($event)"
  />`,
})
class HostComponent {
  public readonly disabled = signal<boolean>(false);
  public readonly picked: File[] = [];
}

describe('FilePickerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const host = (): HTMLElement => fixture.nativeElement;
  const input = (): HTMLInputElement => host().querySelector('input[type="file"]')!;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('mostra o rótulo no botão e repassa accept ao input', () => {
    expect(host().querySelector('button')?.textContent).toContain('Escolher');
    expect(input().accept).toBe('.json');
    expect(input().classList).toContain('ui-file-picker__input');
  });

  it('o botão abre o seletor nativo', () => {
    const click = vi.spyOn(input(), 'click');
    host().querySelector('button')!.click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('emite o arquivo escolhido e limpa o input para aceitar o mesmo arquivo de novo', () => {
    const file = new File(['{}'], 'a.json', { type: 'application/json' });
    // O jsdom não tem DataTransfer: a lista de arquivos é fornecida à mão.
    Object.defineProperty(input(), 'files', {
      configurable: true,
      value: { length: 1, item: (): File => file },
    });
    input().dispatchEvent(new Event('change'));

    expect(fixture.componentInstance.picked).toEqual([file]);
    expect(input().value).toBe('');
  });

  it('desabilitado, o botão e o input ficam inativos', () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    expect(host().querySelector('button')?.disabled).toBe(true);
    expect(input().disabled).toBe(true);
  });

  it('o input fora da tela não entra na ordem de tabulação', () => {
    expect(input().tabIndex).toBe(-1);
    expect(input().getAttribute('aria-hidden')).toBe('true');
  });
});
