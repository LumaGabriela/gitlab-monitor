import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonDirective, ButtonVariant } from './button.directive';

@Component({
  imports: [ButtonDirective],
  template: `
    <button
      type="button"
      appButton
      [variant]="variant()"
      [disabled]="disabled()"
      [loading]="loading()"
    >
      Salvar
    </button>
    <a href="#" appButton [disabled]="disabled()">Link</a>
  `,
})
class HostComponent {
  public readonly variant: WritableSignal<ButtonVariant> = signal<ButtonVariant>('outline');
  public readonly disabled: WritableSignal<boolean> = signal(false);
  public readonly loading: WritableSignal<boolean> = signal(false);
}

describe('ButtonDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  const button = (): HTMLButtonElement => fixture.nativeElement.querySelector('button');
  const link = (): HTMLAnchorElement => fixture.nativeElement.querySelector('a');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('veste o elemento nativo com a classe da variante', () => {
    expect(button().classList).toContain('ui-button');
    expect(button().classList).toContain('ui-button--outline');

    fixture.componentInstance.variant.set('primary');
    fixture.detectChanges();
    expect(button().classList).toContain('ui-button--primary');
  });

  it('no <button>, desabilitar usa o atributo nativo', () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-disabled')).toBeNull();
  });

  it('no <a>, que não tem disabled, usa aria-disabled e sai da tabulação', () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();

    expect(link().getAttribute('aria-disabled')).toBe('true');
    expect(link().getAttribute('tabindex')).toBe('-1');
  });

  it('carregando conta como inativo e anuncia aria-busy', () => {
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();

    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().disabled).toBe(true);
  });
});
