import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { PageHeaderComponent } from './page-header.component';

@Component({
  imports: [PageHeaderComponent],
  template: `<app-page-header
    eyebrow="Workspace / Consumo"
    title="Cards"
    [count]="count()"
    subtitle="Sub"
  >
    <span breadcrumb id="migalha">migalha</span>
    <button actions id="acao" type="button">ação</button>
    <span header-meta id="selo">Started</span>
  </app-page-header>`,
})
class HostComponent {
  public readonly count: WritableSignal<string | null> = signal<string | null>('10 registros');
}

describe('PageHeaderComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('o título é o h1 da página, com eyebrow e subtítulo', () => {
    expect(el().querySelector('h1')?.textContent).toContain('Cards');
    expect(el().querySelector('.ui-page-header__eyebrow')?.textContent).toContain(
      'Workspace / Consumo',
    );
    expect(el().querySelector('.ui-page-header__subtitle')?.textContent).toContain('Sub');
  });

  it('o contador fica ao lado do título e some quando é nulo', () => {
    expect(
      el().querySelector('h1 + .ui-page-header__count, .ui-page-header__count')?.textContent,
    ).toContain('10 registros');
    fixture.componentInstance.count.set(null);
    fixture.detectChanges();
    expect(el().querySelector('.ui-page-header__count')).toBeNull();
  });

  it('projeta os selos abaixo do título (header-meta)', () => {
    expect(el().querySelector('.ui-page-header__meta #selo')).toBeTruthy();
  });

  it('projeta a migalha acima e as ações à direita', () => {
    expect(el().querySelector('.ui-page-header__breadcrumb #migalha')).toBeTruthy();
    expect(el().querySelector('.ui-page-header__actions #acao')).toBeTruthy();
  });
});
