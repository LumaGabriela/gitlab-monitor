import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FieldComponent } from './field.component';
import { TextInputComponent } from '../text-input/text-input.component';

@Component({
  imports: [FieldComponent, TextInputComponent],
  template: `
    <app-field [label]="label()" [hint]="hint()" [error]="error()" [required]="required()">
      <app-text-input />
    </app-field>
  `,
})
class HostComponent {
  public readonly label: WritableSignal<string | null> = signal<string | null>('Projeto');
  public readonly hint: WritableSignal<string | null> = signal<string | null>(null);
  public readonly error: WritableSignal<string | null> = signal<string | null>(null);
  public readonly required: WritableSignal<boolean> = signal(false);
}

describe('FieldComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const query = <T extends Element>(selector: string): T | null =>
    fixture.nativeElement.querySelector(selector);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('liga o rótulo ao controle projetado pelo id', () => {
    // Sem o par for/id, clicar no rótulo não foca o campo e o leitor de tela
    // anuncia o controle sem nome.
    const label = query<HTMLLabelElement>('label');
    const input = query<HTMLInputElement>('input');

    expect(label?.textContent).toContain('Projeto');
    expect(label?.getAttribute('for')).toBe(input?.id);
    expect(input?.id).toBeTruthy();
  });

  it('a ajuda é apontada pelo aria-describedby do controle', () => {
    fixture.componentInstance.hint.set('grupo/projeto ou URL');
    fixture.detectChanges();

    const hint = query<HTMLElement>('.ui-field__helper');
    expect(query<HTMLInputElement>('input')?.getAttribute('aria-describedby')).toBe(hint?.id);
  });

  it('havendo erro, ele substitui a ajuda e marca o controle como inválido', () => {
    fixture.componentInstance.hint.set('grupo/projeto ou URL');
    fixture.componentInstance.error.set('Informe o projeto.');
    fixture.detectChanges();

    const error = query<HTMLElement>('.ui-field__error');
    expect(error?.textContent).toContain('Informe o projeto.');
    expect(query('.ui-field__helper')).toBeNull();

    const input = query<HTMLInputElement>('input');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toBe(error?.id);
  });

  it('obrigatório marca o rótulo e o controle', () => {
    fixture.componentInstance.required.set(true);
    fixture.detectChanges();

    // O asterisco é decoração: quem anuncia a obrigatoriedade é o required
    // do próprio controle.
    expect(query('.ui-field__required')?.getAttribute('aria-hidden')).toBe('true');
    expect(query<HTMLInputElement>('input')?.hasAttribute('required')).toBe(true);
  });
});
