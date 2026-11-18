import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalComponent } from './modal.component';
import { provideTestTranslate } from '../../../../testing/translate';

@Component({
  imports: [ModalComponent],
  template: `
    <button type="button" id="abre">Abrir</button>
    <app-modal [(open)]="open" title="Configurações">
      <input id="dentro" />
      <button type="button" modal-footer id="salvar">Salvar</button>
    </app-modal>
  `,
})
class HostComponent {
  public readonly open: WritableSignal<boolean> = signal(false);
}

describe('ModalComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const host = (): HTMLElement => fixture.nativeElement;
  const panel = (): HTMLElement | null => host().querySelector('.ui-modal__panel');

  const open = (): void => {
    host().querySelector<HTMLButtonElement>('#abre')?.focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTestTranslate()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('fechado, o conteúdo não existe no DOM', () => {
    // Não é só invisível: o que foi digitado não fica pendurado na página.
    expect(panel()).toBeNull();
    expect(host().querySelector('#dentro')).toBeNull();
  });

  it('aberto, é um diálogo nomeado pelo próprio título', () => {
    open();

    expect(panel()?.getAttribute('role')).toBe('dialog');
    expect(panel()?.getAttribute('aria-modal')).toBe('true');
    const titulo = host().querySelector('.ui-modal__title');
    expect(panel()?.getAttribute('aria-labelledby')).toBe(titulo?.id);
    expect(titulo?.textContent).toContain('Configurações');
  });

  it('abrir leva o foco ao painel e fechar devolve a quem abriu', () => {
    const gatilho = host().querySelector<HTMLButtonElement>('#abre');
    open();
    expect(document.activeElement).toBe(panel());

    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(document.activeElement).toBe(gatilho);
  });

  it('Esc fecha', () => {
    open();
    panel()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('clicar no fundo fecha', () => {
    open();
    host().querySelector<HTMLElement>('.ui-modal__backdrop')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('o rodapé projetado fica no rodapé, e o corpo no corpo', () => {
    open();

    expect(host().querySelector('.ui-modal__footer #salvar')).not.toBeNull();
    expect(host().querySelector('.ui-modal__body #dentro')).not.toBeNull();
  });

  it('avisa quem usa quando fechou', () => {
    let fechou = false;
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    fixture.debugElement.children
      .find((child) => child.name === 'app-modal')
      ?.componentInstance.closed.subscribe(() => (fechou = true));

    host().querySelector<HTMLElement>('.ui-modal__close')?.click();
    fixture.detectChanges();

    expect(fechou).toBe(true);
  });
});
