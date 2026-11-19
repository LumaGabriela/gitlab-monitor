import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TextInputComponent } from './text-input.component';

@Component({
  imports: [ReactiveFormsModule, TextInputComponent],
  template: `<app-text-input [formControl]="control" placeholder="grupo/projeto" />`,
})
class HostComponent {
  public readonly control = new FormControl('', { nonNullable: true });
}

@Component({
  imports: [ReactiveFormsModule, TextInputComponent],
  template: `<app-text-input [numeric]="true" [formControl]="control" />`,
})
class NumericHostComponent {
  public readonly control = new FormControl('', { nonNullable: true });
}

describe('TextInputComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const input = (): HTMLInputElement => fixture.nativeElement.querySelector('input');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('é um <input> nativo com o placeholder pedido', () => {
    expect(input().tagName).toBe('INPUT');
    expect(input().placeholder).toBe('grupo/projeto');
    expect(input().classList).toContain('ui-input');
  });

  it('o que o formulário escreve aparece no campo', () => {
    fixture.componentInstance.control.setValue('grupo/projeto');
    fixture.detectChanges();

    expect(input().value).toBe('grupo/projeto');
  });

  it('o que se digita chega ao formulário', () => {
    input().value = 'outro/projeto';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.control.value).toBe('outro/projeto');
  });

  it('o formulário desabilita por método, não por input, e o campo obedece', () => {
    fixture.componentInstance.control.disable();
    fixture.detectChanges();

    expect(input().disabled).toBe(true);
  });

  it('sair do campo marca como tocado', () => {
    expect(fixture.componentInstance.control.touched).toBe(false);

    input().dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(fixture.componentInstance.control.touched).toBe(true);
  });
});

describe('TextInputComponent numérico', () => {
  let fixture: ComponentFixture<NumericHostComponent>;
  const input = (): HTMLInputElement => fixture.nativeElement.querySelector('input');
  const digitar = (texto: string, caret: number = texto.length): void => {
    input().value = texto;
    input().setSelectionRange(caret, caret);
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [NumericHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(NumericHostComponent);
    fixture.detectChanges();
  });

  it('pede o teclado numérico e diz ao navegador o que aceita', () => {
    expect(input().inputMode).toBe('numeric');
    expect(input().getAttribute('pattern')).toBe('[0-9]*');
    // Não é type="number": ali o navegador aceitaria "e" e "-" e devolveria
    // string vazia no que não é número.
    expect(input().type).toBe('text');
  });

  it('só dígitos chegam ao formulário', () => {
    digitar('12');

    expect(fixture.componentInstance.control.value).toBe('12');
  });

  it('o que não é dígito é recusado, e some do campo em vez de ficar na tela', () => {
    digitar('12a');

    expect(fixture.componentInstance.control.value).toBe('12');
    expect(input().value).toBe('12');
  });

  it('colar texto misturado guarda só os dígitos', () => {
    digitar('1 e 2,5-');

    expect(fixture.componentInstance.control.value).toBe('125');
  });

  it('recusar no meio do número não joga o cursor para o fim', () => {
    digitar('1x23', 2);

    expect(input().value).toBe('123');
    expect(input().selectionStart).toBe(1);
  });

  it('apagar tudo deixa o campo vazio, não zerado', () => {
    digitar('7');
    digitar('');

    expect(fixture.componentInstance.control.value).toBe('');
  });
});
