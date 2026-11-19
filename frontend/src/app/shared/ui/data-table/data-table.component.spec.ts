import { Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CellDefDirective } from './cell-def.directive';
import { DataTableComponent } from './data-table.component';
import { TableColumn } from './data-table.model';
import { provideTestTranslate } from '../../../../testing/translate';

interface Linha {
  readonly nome: string;
  readonly total: number;
  readonly vazio?: string;
}

const COLUNAS: readonly TableColumn<Linha>[] = [
  { key: 'nome', header: 'Nome', width: '60%' },
  { key: 'total', header: 'Total', align: 'end', width: '20%' },
  { key: 'vazio', header: 'Vazio', width: '20%' },
];

@Component({
  imports: [CellDefDirective, DataTableComponent],
  template: `
    <app-data-table
      caption="Merge requests abertos"
      [columns]="colunas"
      [rows]="linhas()"
      [loading]="loading()"
      [error]="error()"
      emptyMessage="Nada por aqui."
    >
      <ng-template appCellDef="nome" let-row>
        <strong>{{ row.nome }}</strong>
      </ng-template>
    </app-data-table>
  `,
})
class HostComponent {
  public readonly colunas = COLUNAS;
  public readonly linhas: WritableSignal<readonly Linha[]> = signal<readonly Linha[]>([
    { nome: 'ana.lima', total: 3 },
  ]);
  public readonly loading: WritableSignal<boolean> = signal(false);
  public readonly error: WritableSignal<string | null> = signal<string | null>(null);
}

describe('DataTableComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  const host = (): HTMLElement => fixture.nativeElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTestTranslate()],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('a área rolável é uma região nomeada pela legenda e alcançável pelo teclado', () => {
    const wrapper = host().querySelector('.ui-table-wrapper');
    expect(wrapper?.getAttribute('role')).toBe('region');
    expect(wrapper?.getAttribute('tabindex')).toBe('0');
    expect(wrapper?.getAttribute('aria-label')).toBe('Merge requests abertos');
  });

  it('a legenda some da tela mas fica para o leitor de tela', () => {
    expect(host().querySelector('caption')?.classList).toContain('ui-visually-hidden');
  });

  it('cada coluna vira um cabeçalho com escopo e a largura pedida', () => {
    const headers = [...host().querySelectorAll('th')];
    expect(headers.map((th) => th.textContent?.trim())).toEqual(['Nome', 'Total', 'Vazio']);
    expect(headers.every((th) => th.scope === 'col')).toBe(true);
    expect(host().querySelector('col')?.getAttribute('style')).toContain('60%');
  });

  it('a coluna com template próprio usa o template; as outras, o valor da linha', () => {
    expect(host().querySelector('td strong')?.textContent).toBe('ana.lima');
    expect(host().querySelectorAll('td')[1].textContent?.trim()).toBe('3');
  });

  it('célula sem valor mostra travessão, não um espaço em branco', () => {
    expect(host().querySelectorAll('td')[2].textContent?.trim()).toBe('—');
  });

  it('sem linhas, o motivo ocupa a largura inteira', () => {
    fixture.componentInstance.linhas.set([]);
    fixture.detectChanges();

    const vazio = host().querySelector('.ui-table__empty');
    expect(vazio?.textContent).toContain('Nada por aqui.');
    expect(vazio?.getAttribute('colspan')).toBe('3');
  });

  it('carregando, anuncia ocupado e mostra esqueleto no lugar das linhas', () => {
    fixture.componentInstance.loading.set(true);
    fixture.detectChanges();

    expect(host().querySelector('table')?.getAttribute('aria-busy')).toBe('true');
    expect(host().querySelector('app-skeleton')?.getAttribute('aria-hidden')).toBe('true');
    expect(host().querySelector('td strong')).toBeNull();
  });

  it('com erro, diz o que falhou em vez de parecer vazia', () => {
    // Erro não vira "sem dados": a tela estaria quebrada, não vazia.
    fixture.componentInstance.error.set('O monitor não respondeu.');
    fixture.detectChanges();

    expect(host().querySelector('table')).toBeNull();
    const erro = host().querySelector('.ui-error-state');
    expect(erro?.getAttribute('role')).toBe('alert');
    expect(erro?.textContent).toContain('O monitor não respondeu.');
    expect(erro?.textContent).toContain('Tentar de novo');
  });
});
