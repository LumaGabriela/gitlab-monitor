import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { IconComponent } from '../icon/icon.component';
import { IconButtonDirective } from './icon-button.directive';

@Component({
  imports: [IconButtonDirective, IconComponent],
  template: `<button
    type="button"
    appIconButton
    label="Fechar"
    [size]="size()"
    [disabled]="disabled()"
  >
    <app-icon name="close" />
  </button>`,
})
class HostComponent {
  public readonly size: WritableSignal<'sm' | 'md'> = signal<'sm' | 'md'>('md');
  public readonly disabled: WritableSignal<boolean> = signal(false);
}

// Adaptação: host de link para a engrenagem de /settings (a[appIconButton])
@Component({
  imports: [IconButtonDirective, IconComponent],
  template: `<a appIconButton href="/settings" label="Abrir"><app-icon name="settings" /></a>`,
})
class LinkHostComponent {}

describe('IconButtonDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  const b = (): HTMLButtonElement => fixture.nativeElement.querySelector('button');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('o rótulo obrigatório vira o nome acessível', () => {
    expect(b().getAttribute('aria-label')).toBe('Fechar');
  });

  it('tem classe e tamanho do DS', () => {
    expect(b().classList).toContain('ui-icon-button');
    expect(b().classList).toContain('ui-icon-button--md');
    fixture.componentInstance.size.set('sm');
    fixture.detectChanges();
    expect(b().classList).toContain('ui-icon-button--sm');
  });

  it('desabilitado vira disabled nativo', () => {
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    expect(b().disabled).toBe(true);
  });

  // Adaptação: o seletor a[appIconButton] não existe no metrics
  it('como link, tem a mesma classe e o rótulo vira o nome acessível', () => {
    const linkFixture = TestBed.createComponent(LinkHostComponent);
    linkFixture.detectChanges();
    const a: HTMLAnchorElement = linkFixture.nativeElement.querySelector('a');
    expect(a.classList).toContain('ui-icon-button');
    expect(a.classList).toContain('ui-icon-button--md');
    expect(a.getAttribute('aria-label')).toBe('Abrir');
  });
});
