import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Component } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';

import { provideTestTranslate } from '../../../../testing/translate';
import { NavSection } from '../../models/navigation.model';
import { SidebarComponent } from './sidebar.component';

const SECTIONS: readonly NavSection[] = [
  {
    titleKey: 'nav.workspace',
    items: [
      { id: 'overview', labelKey: 'nav.overview', icon: 'overview', link: '/' },
      { id: 'cards', labelKey: 'nav.cards', icon: 'cards', link: '/cards' },
    ],
  },
];

@Component({ template: '' })
class BlankComponent {}

// Adaptação: chaves de tradução `shell.*` aninhadas, com o catálogo real no lugar de `TranslateModule.forRoot()`.
describe('SidebarComponent', () => {
  function criar() {
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideTestTranslate(),
        provideRouter([{ path: '**', component: BlankComponent }]),
      ],
    });
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('brandName', 'fpf-metrics');
    fixture.componentRef.setInput('brandTagline', 'custo por card');
    fixture.componentRef.setInput('sections', SECTIONS);
    fixture.componentRef.setInput('footerItems', [
      { id: 'connections', labelKey: 'nav.connections', icon: 'connections', link: '/conexoes' },
    ]);
    fixture.detectChanges();
    return fixture;
  }

  it('mostra a marca e uma navegação principal rotulada', () => {
    const el = criar().nativeElement as HTMLElement;
    expect(el.textContent).toContain('fpf-metrics');
    expect(el.textContent).toContain('custo por card');
    const nav = el.querySelector('nav');
    expect(nav?.getAttribute('aria-label')).toBe('Navegação principal');
  });

  it('desenha cada item das seções e do rodapé', () => {
    const el = criar().nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-nav-item').length).toBe(3);
    expect(el.textContent).toContain('nav.workspace');
  });

  it('avisa quando um item é escolhido', async () => {
    const fixture = criar();
    const spy = vi.fn();
    fixture.componentInstance.navigate.subscribe(spy);
    (fixture.nativeElement.querySelector('app-nav-item a') as HTMLAnchorElement).click();
    expect(spy).toHaveBeenCalledWith('overview');
    await fixture.whenStable();
  });
});
