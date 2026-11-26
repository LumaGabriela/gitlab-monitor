import { ComponentFixture, TestBed } from '@angular/core/testing';
import { StackedListComponent } from './stacked-list.component';

describe('StackedListComponent', () => {
  let fixture: ComponentFixture<StackedListComponent>;
  const items = (): HTMLElement[] => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('li'),
  ];

  const render = (values: readonly string[]): void => {
    fixture.componentRef.setInput('items', values);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [StackedListComponent] }).compileComponents();
    fixture = TestBed.createComponent(StackedListComponent);
  });

  it('é uma lista de verdade, um nome por item', () => {
    render(['ana.lima', 'bia.sa']);

    expect(items().map((item) => item.textContent?.trim())).toEqual(['ana.lima,', 'bia.sa']);
  });

  it('o separador não aparece depois do último', () => {
    render(['ana.lima']);

    expect(items()[0].textContent?.trim()).toBe('ana.lima');
  });

  it('lista vazia não deixa uma <ul> solta no DOM', () => {
    render([]);

    expect((fixture.nativeElement as HTMLElement).querySelector('ul')).toBeNull();
  });
});
