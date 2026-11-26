import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CheckboxComponent } from './checkbox.component';

@Component({
  imports: [ReactiveFormsModule, CheckboxComponent],
  template: `<app-checkbox label="Avisar no navegador" [formControl]="control" />`,
})
class HostComponent {
  public readonly control = new FormControl(false, { nonNullable: true });
}

describe('CheckboxComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const input = (): HTMLInputElement => fixture.nativeElement.querySelector('input');
  const label = (): HTMLLabelElement => fixture.nativeElement.querySelector('label');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('o rótulo é clicável junto com a caixa', () => {
    // Por isso o rótulo mora aqui e não num <app-field> em volta.
    expect(label().getAttribute('for')).toBe(input().id);
    expect(label().textContent).toContain('Avisar no navegador');
  });

  it('marcar leva o valor ao formulário', () => {
    input().click();
    fixture.detectChanges();

    expect(fixture.componentInstance.control.value).toBe(true);
  });

  it('o formulário desabilita e a caixa fica inerte', () => {
    fixture.componentInstance.control.disable();
    fixture.detectChanges();

    expect(input().disabled).toBe(true);
    expect(label().classList).toContain('ui-checkbox--disabled');
  });
});
