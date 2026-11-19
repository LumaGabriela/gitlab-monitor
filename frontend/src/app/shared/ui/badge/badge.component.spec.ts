import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BadgeComponent, BadgeTone } from './badge.component';
import { IconName } from '../icon/icon-registry';

@Component({
  imports: [BadgeComponent],
  template: `<app-badge
    [text]="text()"
    [tone]="tone()"
    [icon]="icon()"
    [fixedWidth]="fixedWidth()"
    [label]="label()"
  />`,
})
class HostComponent {
  public readonly text: WritableSignal<string> = signal('3');
  public readonly tone: WritableSignal<BadgeTone> = signal<BadgeTone>('neutral');
  public readonly icon: WritableSignal<IconName | null> = signal<IconName | null>(null);
  public readonly fixedWidth: WritableSignal<boolean> = signal(false);
  public readonly label: WritableSignal<string | null> = signal<string | null>(null);
}

describe('BadgeComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const badge = (): HTMLElement => fixture.nativeElement.querySelector('app-badge');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('mostra o texto com a classe do tom', () => {
    expect(badge().textContent).toContain('3');
    expect(badge().classList).toContain('ui-tag');
    expect(badge().classList).toContain('ui-tag--neutral');

    fixture.componentInstance.tone.set('danger');
    fixture.detectChanges();
    expect(badge().classList).toContain('ui-tag--danger');
  });

  it('reserva largura fixa nas colunas de contagem', () => {
    fixture.componentInstance.fixedWidth.set(true);
    fixture.detectChanges();
    expect(badge().classList).toContain('ui-tag--fixed');
  });

  it('com label, o texto curto some do leitor de tela e o label fica no lugar', () => {
    // "3" sozinho não diz nada a quem não vê a coluna.
    fixture.componentInstance.label.set('3 like(s)');
    fixture.detectChanges();

    expect(badge().getAttribute('aria-label')).toBe('3 like(s)');
    expect(badge().querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('o texto entra com a primeira letra em maiúscula', () => {
    // O backend manda "sem conflito" em caixa baixa, porque na tabela do
    // terminal é um valor no meio da linha; aqui cada um é uma etiqueta.
    fixture.componentInstance.text.set('sem conflito');
    fixture.detectChanges();

    expect(badge().textContent?.trim()).toBe('Sem conflito');
  });

  it('desenha o ícone pedido como decoração', () => {
    fixture.componentInstance.icon.set('likes');
    fixture.detectChanges();

    const icon = badge().querySelector('app-icon');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });
});
