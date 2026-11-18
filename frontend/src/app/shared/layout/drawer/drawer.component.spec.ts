import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DrawerComponent } from './drawer.component';

@Component({
  imports: [DrawerComponent],
  template: `
    <button id="abrir" type="button" (click)="open.set(true)">abrir</button>
    <app-drawer [(open)]="open" label="Menu" (closed)="closedCount = closedCount + 1">
      <a href="/x" id="primeiro">primeiro</a>
    </app-drawer>
  `,
})
class HostComponent {
  public readonly open: WritableSignal<boolean> = signal(false);
  public closedCount = 0;
}

describe('DrawerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const panel = (): HTMLElement | null => el().querySelector('[role="dialog"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  async function abrir(): Promise<void> {
    const botao = el().querySelector('#abrir') as HTMLButtonElement;
    botao.focus();
    botao.click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('fechada não desenha nada', () => {
    expect(panel()).toBeNull();
  });

  it('aberta é um diálogo modal rotulado', async () => {
    await abrir();
    expect(panel()?.getAttribute('aria-modal')).toBe('true');
    expect(panel()?.getAttribute('aria-label')).toBe('Menu');
  });

  it('ao abrir, o foco vai para dentro da gaveta', async () => {
    await abrir();
    expect(panel()?.contains(document.activeElement)).toBe(true);
  });

  it('Esc fecha, avisa e devolve o foco a quem abriu', async () => {
    await abrir();
    panel()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
    expect(fixture.componentInstance.closedCount).toBe(1);
    expect(panel()).toBeNull();
    expect(document.activeElement?.id).toBe('abrir');
  });

  it('quando o pai fecha (open=false), o foco também volta e "closed" é emitido', async () => {
    await abrir();
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel()).toBeNull();
    expect(document.activeElement?.id).toBe('abrir');
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('clicar no fundo fecha', async () => {
    await abrir();
    (el().querySelector('.ui-drawer__backdrop') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
  });
});
