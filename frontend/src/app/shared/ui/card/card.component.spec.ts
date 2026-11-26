import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CardComponent } from './card.component';

@Component({
  imports: [CardComponent],
  template: `<app-card [title]="title()" [count]="count()" [headingLevel]="level()">
    <p>Corpo</p>
    <button card-actions type="button">Ação</button>
  </app-card>`,
})
class HostComponent {
  public readonly title: WritableSignal<string | null> = signal<string | null>(null);
  public readonly count: WritableSignal<string | null> = signal<string | null>(null);
  public readonly level: WritableSignal<2 | 3> = signal<2 | 3>(2);
}

describe('CardComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const host = (): HTMLElement => fixture.nativeElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('sem título, não desenha cabeçalho nenhum', () => {
    expect(host().querySelector('.ui-card__header')).toBeNull();
    expect(host().querySelector('.ui-card__body')?.textContent).toContain('Corpo');
  });

  it('quem usa escolhe o nível do título, porque a hierarquia é da página', () => {
    fixture.componentInstance.title.set('Filtros');
    fixture.detectChanges();
    expect(host().querySelector('h2')?.textContent).toContain('Filtros');

    fixture.componentInstance.level.set(3);
    fixture.detectChanges();
    expect(host().querySelector('h3')?.textContent).toContain('Filtros');
  });

  it('as ações projetadas ficam no cabeçalho, ao lado do título', () => {
    fixture.componentInstance.title.set('Filtros');
    fixture.componentInstance.count.set('9');
    fixture.detectChanges();

    expect(host().querySelector('.ui-card__actions button')?.textContent).toContain('Ação');
    expect(host().querySelector('.ui-card__count')?.textContent).toContain('9');
  });
});
