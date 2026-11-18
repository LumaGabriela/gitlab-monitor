import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { provideTestTranslate } from '../../../../testing/translate';
import { SelectComponent } from './select.component';
import { SelectOption } from './select.model';

@Component({
  imports: [SelectComponent, ReactiveFormsModule],
  template: `<app-select
    [formControl]="control"
    [options]="options"
    placeholder="Todos os projetos"
    ariaLabel="Projeto"
  />`,
})
class HostComponent {
  public readonly control: FormControl<string> = new FormControl<string>('', { nonNullable: true });
  public readonly options: readonly SelectOption[] = [
    { value: 'ANT', label: 'ANT' },
    { value: 'SIG', label: 'SIG' },
    { value: 'GOV', label: 'GOV', disabled: true },
  ];
}

/**
 * A tela do painel abre com as ordenações vazias: `/data` ainda não respondeu,
 * mas o valor guardado já vale. É o caso que quebrava o cdkListbox.
 */
@Component({
  imports: [SelectComponent, ReactiveFormsModule],
  template: `<app-select [formControl]="control" [options]="options()" ariaLabel="Ordenar por" />`,
})
class LateOptionsHost {
  public readonly control: FormControl<string> = new FormControl<string>('recent', {
    nonNullable: true,
  });
  public readonly options: WritableSignal<readonly SelectOption[]> = signal<
    readonly SelectOption[]
  >([]);
}

describe('SelectComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let control: FormControl<string>;
  const gatilho = (): HTMLButtonElement => fixture.nativeElement.querySelector('button');
  const lista = (): HTMLElement | null => document.querySelector('[role="listbox"]');
  const opcoes = (): HTMLElement[] => [
    ...(lista()?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
  ];

  const painel = (): HTMLElement | null => document.querySelector('.ui-select-panel');
  const busca = (): HTMLInputElement | null =>
    document.querySelector('.ui-select-panel__search-input');

  async function digitar(termo: string): Promise<void> {
    const campo = busca() as HTMLInputElement;
    campo.value = termo;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function abrir(): Promise<void> {
    gatilho().click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTestTranslate()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    control = fixture.componentInstance.control;
    fixture.detectChanges();
  });

  it('o gatilho é um botão de seleção, fechado, mostrando o placeholder', () => {
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(gatilho().getAttribute('role')).toBe('combobox');
    expect(gatilho().getAttribute('aria-haspopup')).toBe('listbox');
    expect(gatilho().getAttribute('aria-expanded')).toBe('false');
    expect(gatilho().getAttribute('aria-label')).toBe('Projeto');
    expect(gatilho().textContent?.trim()).toBe('Todos os projetos');
    expect(lista()).toBeNull();
  });

  it('abre a lista própria, com o placeholder como primeira opção', async () => {
    await abrir();
    expect(gatilho().getAttribute('aria-expanded')).toBe('true');
    expect(opcoes().map((o) => o.textContent?.trim())).toEqual([
      'Todos os projetos',
      'ANT',
      'SIG',
      'GOV',
    ]);
    expect(opcoes()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('a seta é um app-icon decorativo (segue o tema), não imagem de fundo', () => {
    const seta = fixture.nativeElement.querySelector('.ui-select-wrap app-icon') as HTMLElement;
    expect(seta).toBeTruthy();
    expect(seta.getAttribute('aria-hidden')).toBe('true');
  });

  it('escolher uma opção atualiza o FormControl, fecha a lista e devolve o foco', async () => {
    await abrir();
    opcoes()[2].click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(control.value).toBe('SIG');
    expect(gatilho().textContent?.trim()).toBe('SIG');
    expect(lista()).toBeNull();
    expect(document.activeElement).toBe(gatilho());
  });

  it('o valor do FormControl manda no rótulo e na opção marcada', async () => {
    control.setValue('ANT');
    fixture.detectChanges();
    expect(gatilho().textContent?.trim()).toBe('ANT');
    await abrir();
    expect(opcoes()[1].getAttribute('aria-selected')).toBe('true');
    expect(opcoes()[0].getAttribute('aria-selected')).toBe('false');
  });

  it('desabilitar o FormControl desabilita o gatilho, que não abre', async () => {
    control.disable();
    fixture.detectChanges();
    expect(gatilho().disabled).toBe(true);
    await abrir();
    expect(lista()).toBeNull();
  });

  it('Esc fecha a lista sem mudar o valor', async () => {
    await abrir();
    lista()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(lista()).toBeNull();
    expect(control.value).toBe('');
  });

  it('opção desabilitada é anunciada e não muda o valor', async () => {
    await abrir();
    const desabilitada = opcoes()[3];
    expect(desabilitada.getAttribute('aria-disabled')).toBe('true');
    desabilitada.click();
    fixture.detectChanges();
    expect(control.value).toBe('');
  });

  describe('busca', () => {
    it('o painel abre com o campo de busca focado', async () => {
      await abrir();
      expect(busca()).not.toBeNull();
      expect(document.activeElement).toBe(busca());
    });

    it('digitar filtra a lista, sem acento e sem caixa', async () => {
      await abrir();
      await digitar('si');
      expect(opcoes().map((o) => o.textContent?.trim())).toEqual(['SIG']);
    });

    it('com a busca em uso o placeholder sai da lista: ele não é uma opção procurável', async () => {
      await abrir();
      await digitar('g');
      expect(opcoes().map((o) => o.textContent?.trim())).toEqual(['SIG', 'GOV']);
    });

    it('termo sem resultado diz que não achou, em vez de lista vazia', async () => {
      await abrir();
      await digitar('zzz');
      expect(opcoes()).toEqual([]);
      expect(painel()?.textContent).toContain('Nenhuma opção encontrada');
    });

    it('a seta para baixo passa o foco da busca para a lista', async () => {
      await abrir();
      busca()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      // O foco pode parar na própria lista ou na opção ativa: quem decide é o
      // cdkListbox. O que importa é ter saído da busca e entrado na lista.
      const ativo: Element | null = document.activeElement;
      expect(ativo === lista() || lista()?.contains(ativo as Node)).toBe(true);
    });

    it('escolher pela busca guarda o valor, e reabrir mostra a lista inteira', async () => {
      await abrir();
      await digitar('si');
      opcoes()[0].click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(control.value).toBe('SIG');

      await abrir();
      expect(busca()?.value).toBe('');
      expect(opcoes().length).toBe(4);
    });
  });
});

describe('SelectComponent com opções que chegam depois', () => {
  it('abrir antes de as opções existirem não surda a lista: escolher ainda vale', async () => {
    await TestBed.configureTestingModule({
      imports: [LateOptionsHost],
      providers: [provideTestTranslate()],
    }).compileComponents();
    const tardio: ComponentFixture<LateOptionsHost> = TestBed.createComponent(LateOptionsHost);
    tardio.detectChanges();

    // O painel abre com a lista vazia, e o valor guardado ('recent') não tem
    // opção nenhuma que lhe corresponda.
    tardio.nativeElement.querySelector('button').click();
    tardio.detectChanges();
    await tardio.whenStable();
    tardio.detectChanges();

    // Agora /data chega.
    tardio.componentInstance.options.set([
      { value: 'recent', label: 'Criado' },
      { value: 'author', label: 'Autor' },
    ]);
    tardio.detectChanges();
    await tardio.whenStable();
    tardio.detectChanges();

    const alvo = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent?.trim() === 'Autor',
    );
    expect(alvo, 'a opção Autor precisa estar na lista antes do clique').toBeTruthy();
    alvo?.click();
    tardio.detectChanges();
    await tardio.whenStable();

    expect(tardio.componentInstance.control.value).toBe('author');
  });
});
