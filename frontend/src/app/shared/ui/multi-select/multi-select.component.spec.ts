import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MultiSelectComponent } from './multi-select.component';
import { SelectOption } from '../select/select.model';
import { provideTestTranslate } from '../../../../testing/translate';

const OPTIONS: readonly SelectOption[] = [
  { value: 'ana.lima', label: 'ana.lima' },
  { value: 'bia.sa', label: 'bia.sa' },
];

@Component({
  imports: [ReactiveFormsModule, MultiSelectComponent],
  template: `<app-multi-select [options]="options" [formControl]="control" placeholder="Todos" />`,
})
class HostComponent {
  public readonly options = OPTIONS;
  public readonly control = new FormControl<readonly string[]>([], { nonNullable: true });
}

describe('MultiSelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const trigger = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('.ui-multi-select__trigger');
  const boxes = (): HTMLInputElement[] => [
    ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      '.ui-multi-select__panel input[type="checkbox"]',
    ),
  ];

  const openPanel = (): void => {
    trigger().click();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTestTranslate()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('sem nada marcado, o gatilho mostra o placeholder', () => {
    expect(trigger().textContent).toContain('Todos');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('o painel marca várias opções sem fechar entre uma e outra', () => {
    // É o ponto da escolha múltipla: fechar a cada clique obrigaria a
    // reabrir o painel para cada autor.
    openPanel();
    expect(boxes().length).toBe(2);

    boxes()[0].click();
    fixture.detectChanges();
    expect(boxes().length).toBe(2);

    boxes()[1].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.control.value).toEqual(['ana.lima', 'bia.sa']);
  });

  it('clicar de novo em uma marcada desmarca', () => {
    fixture.componentInstance.control.setValue(['ana.lima']);
    openPanel();

    expect(boxes()[0].checked).toBe(true);
    boxes()[0].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.control.value).toEqual([]);
  });

  it('o gatilho diz se o painel está aberto', () => {
    openPanel();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const panel = (fixture.nativeElement as HTMLElement).querySelector('.ui-multi-select__panel');
    expect(trigger().getAttribute('aria-controls')).toBe(panel?.id);
  });

  it('com um só marcado mostra o nome; com vários, a contagem', () => {
    fixture.componentInstance.control.setValue(['ana.lima']);
    fixture.detectChanges();
    expect(trigger().textContent).toContain('ana.lima');

    fixture.componentInstance.control.setValue(['ana.lima', 'bia.sa']);
    fixture.detectChanges();
    expect(trigger().textContent).toContain('2 selecionados');
  });

  describe('busca', () => {
    const search = (): HTMLInputElement | null =>
      (fixture.nativeElement as HTMLElement).querySelector('.ui-select-panel__search-input');
    const labels = (): (string | undefined)[] =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('.ui-multi-select__option')].map(
        (item) => item.textContent?.trim(),
      );

    const type = (term: string): void => {
      const campo = search() as HTMLInputElement;
      campo.value = term;
      campo.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    it('o painel abre com o campo de busca', () => {
      openPanel();
      expect(search()).not.toBeNull();
    });

    it('digitar filtra as caixas, sem desmarcar o que está fora do termo', () => {
      fixture.componentInstance.control.setValue(['ana.lima']);
      openPanel();
      type('bia');

      expect(labels()).toEqual(['bia.sa']);
      expect(fixture.componentInstance.control.value).toEqual(['ana.lima']);

      type('');
      expect(labels()).toEqual(['ana.lima', 'bia.sa']);
      expect(boxes()[0].checked).toBe(true);
    });

    it('termo sem resultado diz que não achou', () => {
      openPanel();
      type('zzz');

      expect(boxes()).toEqual([]);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'Nenhuma opção encontrada',
      );
    });

    it('reabrir limpa o termo e traz a lista inteira', () => {
      openPanel();
      type('bia');
      expect(labels()).toEqual(['bia.sa']);

      trigger().click();
      fixture.detectChanges();
      openPanel();

      expect(search()?.value).toBe('');
      expect(labels()).toEqual(['ana.lima', 'bia.sa']);
    });
  });

  it('Esc fecha o painel', () => {
    openPanel();
    expect(boxes().length).toBe(2);

    (fixture.nativeElement as HTMLElement)
      .querySelector('app-multi-select')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(boxes().length).toBe(0);
  });
});
