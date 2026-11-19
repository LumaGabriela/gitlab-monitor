import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { provideTestTranslate } from '../../../../testing/translate';
import { NavSection } from '../../models/navigation.model';
import { ShellComponent } from './shell.component';

@Component({
  imports: [ShellComponent],
  template: `<app-shell brandName="fpf-metrics" brandTagline="t" [sections]="sections">
    <p id="conteudo-projetado">conteúdo</p>
  </app-shell>`,
})
class HostComponent {
  public readonly sections: readonly NavSection[] = [
    { items: [{ id: 'cards', labelKey: 'nav.cards', icon: 'cards', link: '/cards' }] },
  ];
}

@Component({ template: '' })
class BlankComponent {}

// Adaptação: chaves de tradução `shell.*` aninhadas, com o catálogo real no lugar de `TranslateModule.forRoot()`.
describe('ShellComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const menuButton = (): HTMLButtonElement =>
    el().querySelector('.ui-shell__menu-button') as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTestTranslate(),
        provideRouter([{ path: '**', component: BlankComponent }]),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });

  it('projeta o conteúdo da página dentro de <main> com id para o link de pular', () => {
    const main = el().querySelector('main');
    expect(main?.id).toBe('conteudo');
    expect(main?.querySelector('#conteudo-projetado')).toBeTruthy();
    expect(el().querySelector('a.ui-shell__skip')?.getAttribute('href')).toBe('#conteudo');
  });

  it('"pular para o conteúdo" foca o <main> sem navegar (o <base href> faria #conteudo ir para /)', () => {
    const link = el().querySelector('a.ui-shell__skip') as HTMLAnchorElement;
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('conteudo');
  });

  it('tem a barra lateral fixa (para telas largas)', () => {
    expect(el().querySelector('.ui-shell__sidebar app-sidebar')).toBeTruthy();
  });

  it('o botão de menu abre a gaveta com a mesma navegação e anuncia o estado', async () => {
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(menuButton().getAttribute('aria-label')).toBe('Abrir o menu');
    menuButton().click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(el().querySelector('app-drawer [role="dialog"] app-sidebar')).toBeTruthy();
  });

  it('o botão da barra superior (celular) usa o ícone panel-left-open', () => {
    expect(menuButton().querySelector('svg')?.getAttribute('class')).toContain(
      'lucide-panel-left-open',
    );
  });

  it('desktop: o botão no topo do menu reduz a trilho e expande de novo, com ícone e rótulo do estado', () => {
    const shell = (): HTMLElement => el().querySelector('.ui-shell') as HTMLElement;
    const botao = (): HTMLButtonElement =>
      el().querySelector('.ui-shell__sidebar .ui-sidebar__toggle') as HTMLButtonElement;
    const icone = (): string => botao().querySelector('svg')?.getAttribute('class') ?? '';
    expect(shell().classList).not.toContain('ui-shell--rail');
    expect(botao().getAttribute('aria-expanded')).toBe('true');
    expect(botao().getAttribute('aria-label')).toBe('Recolher o menu');
    expect(icone()).toContain('lucide-panel-left-close');
    botao().click();
    fixture.detectChanges();
    expect(shell().classList).toContain('ui-shell--rail');
    expect(botao().getAttribute('aria-expanded')).toBe('false');
    expect(botao().getAttribute('aria-label')).toBe('Expandir o menu');
    expect(icone()).toContain('lucide-panel-left-open');
    expect(el().querySelector('.ui-shell__sidebar .ui-sidebar--rail')).toBeTruthy();
    // No trilho a marca continua à vista, logo abaixo do botão de abrir o menu.
    const topo = el().querySelector('.ui-shell__sidebar .ui-sidebar__brand') as HTMLElement;
    const ordem = [...topo.children].map((c) =>
      c.classList.contains('ui-sidebar__toggle')
        ? 'botao'
        : c.classList.contains('ui-sidebar__mark')
          ? 'marca'
          : 'outro',
    );
    expect(ordem).toEqual(['botao', 'marca']);
    botao().click();
    fixture.detectChanges();
    expect(shell().classList).not.toContain('ui-shell--rail');
  });

  // Adaptação: o trilho não é guardado (requisito 6 e gate de armazenamento); no lugar do caso de persistência.
  it('abre sempre expandida e recolher não grava nada no navegador', () => {
    expect(el().querySelector('.ui-shell--rail')).toBeNull();
    el().querySelector<HTMLButtonElement>('.ui-sidebar__toggle')!.click();
    fixture.detectChanges();
    expect(el().querySelector('.ui-shell--rail')).not.toBeNull();
  });

  it('na gaveta, o botão do topo do menu (panel-left-close) fecha a gaveta', async () => {
    menuButton().click();
    fixture.detectChanges();
    await fixture.whenStable();
    const fechar = el().querySelector('app-drawer .ui-sidebar__toggle') as HTMLButtonElement;
    expect(fechar.getAttribute('aria-label')).toBe('Fechar o menu');
    expect(fechar.querySelector('svg')?.getAttribute('class')).toContain('lucide-panel-left-close');
    fechar.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el().querySelector('app-drawer [role="dialog"]')).toBeNull();
  });

  it('escolher um item na gaveta fecha a gaveta', async () => {
    menuButton().click();
    fixture.detectChanges();
    await fixture.whenStable();
    (el().querySelector('app-drawer app-nav-item a') as HTMLAnchorElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el().querySelector('app-drawer [role="dialog"]')).toBeNull();
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ShellComponent — gaveta e breakpoint', () => {
  let ouvinte: ((e: { matches: boolean }) => void) | null = null;
  let consulta = '';

  beforeEach(() => {
    document.documentElement.style.setProperty('--breakpoint-md', '768px');
    vi.stubGlobal('matchMedia', (q: string) => {
      consulta = q;
      return {
        matches: false,
        addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => (ouvinte = fn),
        removeEventListener: () => (ouvinte = null),
      };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty('--breakpoint-md');
  });

  it('a gaveta aberta fecha quando a janela passa do breakpoint md (token --breakpoint-md)', async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideTestTranslate(),
        provideRouter([{ path: '**', component: BlankComponent }]),
      ],
    }).compileComponents();
    const f = TestBed.createComponent(HostComponent);
    document.body.appendChild(f.nativeElement);
    f.detectChanges();
    expect(consulta).toBe('(min-width: 768px)');
    const el = f.nativeElement as HTMLElement;
    (el.querySelector('.ui-shell__menu-button') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.ui-shell__menu-button')?.getAttribute('aria-expanded')).toBe('true');
    ouvinte?.({ matches: true });
    f.detectChanges();
    expect(el.querySelector('.ui-shell__menu-button')?.getAttribute('aria-expanded')).toBe('false');
    f.destroy();
    expect(ouvinte).toBeNull();
  });
});
