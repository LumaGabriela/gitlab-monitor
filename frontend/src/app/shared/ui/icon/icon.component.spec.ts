import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { IconComponent, IconName, IconSize } from './icon.component';

@Component({
  imports: [IconComponent],
  template: `<app-icon [name]="name()" [size]="size()" [label]="label()" />`,
})
class HostComponent {
  public readonly name: WritableSignal<IconName> = signal<IconName>('copy');
  public readonly size: WritableSignal<IconSize> = signal<IconSize>('md');
  public readonly label: WritableSignal<string | null> = signal<string | null>(null);
}

describe('IconComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  const host = (): HTMLElement => fixture.nativeElement.querySelector('app-icon') as HTMLElement;
  const svg = (): SVGElement => host().querySelector('svg') as SVGElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('desenha o ícone pedido como svg', () => {
    expect(svg()).toBeTruthy();
    expect(svg().innerHTML.length).toBeGreaterThan(0);
  });

  it('sem rótulo é decorativo: escondido do leitor de tela', () => {
    expect(host().getAttribute('aria-hidden')).toBe('true');
    expect(host().getAttribute('role')).toBeNull();
  });

  it('com rótulo é uma imagem com nome acessível', () => {
    fixture.componentInstance.label.set('Copiar o id');
    fixture.detectChanges();

    expect(host().getAttribute('role')).toBe('img');
    expect(host().getAttribute('aria-label')).toBe('Copiar o id');
    expect(host().getAttribute('aria-hidden')).toBeNull();
  });

  it('o tamanho vira classe do DS (sem px no componente)', () => {
    expect(host().classList).toContain('ui-icon--md');
    fixture.componentInstance.size.set('lg');
    fixture.detectChanges();
    expect(host().classList).toContain('ui-icon--lg');
    expect(host().classList).not.toContain('ui-icon--md');
  });

  it('trocar o nome troca o desenho', () => {
    const antes = svg().innerHTML;
    fixture.componentInstance.name.set('check');
    fixture.detectChanges();
    expect(svg().innerHTML).not.toBe(antes);
  });
});
