import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TooltipDirective } from './tooltip.directive';

@Component({
  imports: [TooltipDirective],
  template: `<button type="button" appTooltip="spec · 180.000 tokens">spec</button>
    <input id="campo" aria-describedby="ajuda" appTooltip="dica do campo" />`,
})
class HostComponent {}

describe('TooltipDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  const alvo = (): HTMLButtonElement => fixture.nativeElement.querySelector('button');
  const tip = (): HTMLElement | null => document.querySelector('[role="tooltip"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('abre no foco (teclado), com o texto, e descreve o alvo', () => {
    alvo().dispatchEvent(new FocusEvent('focus'));
    expect(tip()?.textContent).toBe('spec · 180.000 tokens');
    expect(alvo().getAttribute('aria-describedby')).toBe(tip()?.id);
  });

  it('abre no hover e fecha ao sair', () => {
    alvo().dispatchEvent(new MouseEvent('mouseenter'));
    expect(tip()).toBeTruthy();
    alvo().dispatchEvent(new MouseEvent('mouseleave'));
    expect(tip()).toBeNull();
    expect(alvo().getAttribute('aria-describedby')).toBeNull();
  });

  it('preserva a descrição que o alvo já tinha (ajuda ou erro do campo)', () => {
    const campo = fixture.nativeElement.querySelector('#campo') as HTMLInputElement;
    campo.dispatchEvent(new FocusEvent('focus'));
    const id = document.querySelector('[role="tooltip"]')?.id;
    expect(campo.getAttribute('aria-describedby')).toBe(`ajuda ${id}`);
    campo.dispatchEvent(new FocusEvent('blur'));
    expect(campo.getAttribute('aria-describedby')).toBe('ajuda');
  });

  it('Esc fecha', () => {
    alvo().dispatchEvent(new FocusEvent('focus'));
    alvo().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tip()).toBeNull();
  });
});
