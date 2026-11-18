import { Component, signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { NavItemComponent } from './nav-item.component';

@Component({ template: '' })
class BlankComponent {}

@Component({
  imports: [NavItemComponent],
  template: `<app-nav-item
    label="Cards"
    icon="cards"
    link="/cards"
    [active]="active()"
    [disabled]="disabled()"
    (selected)="selections = selections + 1"
  />`,
})
class HostComponent {
  public readonly active: WritableSignal<boolean> = signal(false);
  public readonly disabled: WritableSignal<boolean> = signal(false);
  public selections = 0;
}

describe('NavItemComponent', () => {
  let harness: RouterTestingHarness;
  let host: HostComponent;
  const link = (): HTMLAnchorElement =>
    harness.routeNativeElement?.querySelector('a') as HTMLAnchorElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: '', component: HostComponent },
          { path: 'cards', component: HostComponent },
          { path: 'outra', component: BlankComponent },
          { path: 'settings', component: BlankComponent },
          { path: 'settings/columns', component: BlankComponent },
        ]),
      ],
    });
    harness = await RouterTestingHarness.create();
    host = await harness.navigateByUrl('/', HostComponent);
  });

  it('é um link real para a rota, com ícone e rótulo', () => {
    expect(link().getAttribute('href')).toBe('/cards');
    expect(link().textContent?.trim()).toBe('Cards');
    expect(link().querySelector('app-icon')).toBeTruthy();
  });

  it('marca aria-current="page" quando a rota está ativa', async () => {
    expect(link().getAttribute('aria-current')).toBeNull();
    host = await harness.navigateByUrl('/cards', HostComponent);
    harness.detectChanges();
    expect(link().getAttribute('aria-current')).toBe('page');
    expect(link().classList).toContain('ui-nav-item--active');
  });

  it('pode ser marcado ativo pela entrada (vitrine, sem rota)', () => {
    host.active.set(true);
    harness.detectChanges();
    expect(link().getAttribute('aria-current')).toBe('page');
  });

  it('desabilitado: sem href, fora da ordem de tabulação e anunciado como desabilitado', () => {
    host.disabled.set(true);
    harness.detectChanges();
    expect(link().getAttribute('href')).toBeNull();
    expect(link().getAttribute('aria-disabled')).toBe('true');
    expect(link().getAttribute('tabindex')).toBe('-1');
  });

  it('avisa quando é escolhido (a gaveta usa isso para fechar)', () => {
    link().click();
    expect(host.selections).toBe(1);
  });

  it('leva os query params recebidos (filtros que valem entre telas)', () => {
    const f = TestBed.createComponent(NavItemComponent);
    f.componentRef.setInput('label', 'Cards');
    f.componentRef.setInput('icon', 'cards');
    f.componentRef.setInput('link', '/cards');
    f.componentRef.setInput('queryParams', { projeto: 'ANT' });
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('a')?.getAttribute('href')).toBe(
      '/cards?projeto=ANT',
    );
  });

  it('a raiz continua ativa com filtros na URL (query params não contam para "ativo")', async () => {
    await harness.navigateByUrl('/?visao=tabela');
    const f = TestBed.createComponent(NavItemComponent);
    f.componentRef.setInput('label', 'Visão geral');
    f.componentRef.setInput('icon', 'overview');
    f.componentRef.setInput('link', '/');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('a')?.getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('compacto (menu em trilho): só o ícone à vista; o rótulo segue como nome acessível e aparece como dica', () => {
    const f = TestBed.createComponent(NavItemComponent);
    f.componentRef.setInput('label', 'Cards');
    f.componentRef.setInput('icon', 'cards');
    f.componentRef.setInput('link', '/cards');
    f.componentRef.setInput('compact', true);
    f.detectChanges();
    const a = (f.nativeElement as HTMLElement).querySelector('a') as HTMLAnchorElement;
    expect(a.classList).toContain('ui-nav-item--compact');
    expect(a.querySelector('.ui-nav-item__label')?.classList).toContain('ui-visually-hidden');
    expect(a.textContent?.trim()).toBe('Cards');
    a.dispatchEvent(new MouseEvent('mouseenter'));
    expect(document.querySelector('.ui-tooltip')?.textContent).toBe('Cards');
    a.dispatchEvent(new MouseEvent('mouseleave'));
  });

  // Adaptação: `exact` é acréscimo do gitlab-monitor (o item /settings não fica ativo em /settings/columns).
  it('com exact, não fica ativo numa sub-rota', async () => {
    await harness.navigateByUrl('/settings/columns');
    const f = TestBed.createComponent(NavItemComponent);
    f.componentRef.setInput('label', 'Configurações');
    f.componentRef.setInput('icon', 'settings');
    f.componentRef.setInput('link', '/settings');
    f.componentRef.setInput('exact', true);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const anchor = (f.nativeElement as HTMLElement).querySelector('a') as HTMLAnchorElement;
    expect(anchor.classList.contains('ui-nav-item--active')).toBe(false);
    expect(anchor.getAttribute('aria-current')).toBeNull();
  });

  it('sem exact, fica ativo numa sub-rota', async () => {
    await harness.navigateByUrl('/settings/columns');
    const f = TestBed.createComponent(NavItemComponent);
    f.componentRef.setInput('label', 'Configurações');
    f.componentRef.setInput('icon', 'settings');
    f.componentRef.setInput('link', '/settings');
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const anchor = (f.nativeElement as HTMLElement).querySelector('a') as HTMLAnchorElement;
    expect(anchor.getAttribute('aria-current')).toBe('page');
  });
});
