import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TranslateService } from '@ngx-translate/core';
import { ColumnModel, MrRowModel, SortOptionModel } from '../../../core/models/api/panel-api.model';
import { Preferences } from '../../../core/models/api/preferences-api.model';
import { RuleTone } from '../../../core/rules/rule-engine';
import { ColumnOrderService } from '../../../core/services/column-order.service';
import { RowRulesService } from '../../../core/services/row-rules.service';
import { MrTableComponent, SortRequest } from './mr-table.component';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';

const COLUMNS: readonly ColumnModel[] = [
  { key: 'likes', label: 'Likes', cell: 'likes', weight: 10 },
  { key: 'mr', label: 'MR', cell: 'link', weight: 36 },
  { key: 'author', label: 'Autor', cell: 'text', weight: 18 },
  { key: 'pipeline', label: 'Pipeline', cell: 'badge', weight: 13 },
  { key: 'updated_label', label: 'Atualizado', cell: 'time', weight: 18 },
];

const ROW: MrRowModel = {
  cells: {
    likes: { label: '3', tone: 'strong', icon: 'likes', mine: true, likers: ['ana.lima'] },
    mr: { label: 'BE #199 título', url: 'https://gitlab.example/mr/199' },
    author: { label: 'geovana.medeiros' },
    pipeline: { label: 'falhou', tone: 'danger' },
    updated_label: { label: 'há 2 horas', title: '2026-11-16T10:00:00Z' },
  },
  changed: ['pipeline'],
  facts: {
    likes: 3,
    unresolved: 1,
    participants: 1,
    mergeable: true,
    conflicts: false,
    pipeline: 'failed',
    author: 'geovana.medeiros',
    mine: true,
    involved: true,
    draft: false,
    ageHours: 48,
    idleHours: 2,
    assignedToMe: false,
    reviewingMine: false,
    myReviewState: '',
    assignees: 0,
    reviewers: 0,
  },
};

describe('MrTableComponent', () => {
  let fixture: ComponentFixture<MrTableComponent>;
  const host = (): HTMLElement => fixture.nativeElement;

  const render = (rows: readonly MrRowModel[] = [ROW], hidden: readonly string[] = []): void => {
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('hiddenColumns', hidden);
    fixture.componentRef.setInput('emptyMessage', 'Nenhum MR aberto para este alvo.');
    fixture.detectChanges();
  };

  /** Só a coluna de pessoas, para o desenho dela não depender das demais. */
  const renderPeople = (names: readonly string[]): void => {
    fixture.componentRef.setInput('columns', [
      { key: 'review', label: 'Revisão', cell: 'people', weight: 16 },
    ]);
    fixture.componentRef.setInput('rows', [
      {
        ...ROW,
        cells: { review: { label: names.join(' · ') || '—', names } },
      },
    ]);
    fixture.detectChanges();
  };

  const build = async (preferences: Preferences = {}): Promise<void> => {
    await TestBed.configureTestingModule({
      imports: [MrTableComponent],
      providers: [
        provideTestTranslate(),
        providePreferences(new FakePreferencesStore(preferences)),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MrTableComponent);
  };

  /** Duas regras que a linha do exemplo casa, na ordem em que são criadas. */
  const adicionarDuasRegras = (primeiro: RuleTone, segundo: RuleTone): void => {
    const rules = TestBed.inject(RowRulesService);
    rules.add({
      field: 'pipeline',
      operator: 'eq',
      value: 'failed',
      tone: primeiro,
      markStyle: 'solid',
      enabled: true,
    });
    rules.add({
      field: 'likes',
      operator: 'gte',
      value: '3',
      tone: segundo,
      markStyle: 'dotted',
      enabled: true,
    });
  };

  /** Recomeça com preferências já guardadas, para o serviço nascer com elas. */
  const recreateWith = async (preferences: Preferences): Promise<void> => {
    TestBed.resetTestingModule();
    await build(preferences);
  };

  beforeEach(async () => {
    await build();
  });

  it('desenha cada célula pelo tipo que a coluna declara', () => {
    // A tabela não conhece nenhuma coluna pelo nome: tudo vem do "cell".
    render();

    const link = host().querySelector('app-external-link a');
    expect(link?.getAttribute('href')).toBe('https://gitlab.example/mr/199');
    // Nova aba com rel seguro e aviso para quem não vê a mudança de aba.
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.querySelector('.ui-visually-hidden')?.textContent).toContain('nova aba');
    expect(host().querySelectorAll('app-badge').length).toBe(2); // likes e pipeline
    expect(host().querySelector('time')?.getAttribute('title')).toBe('2026-11-16T10:00:00Z');
    expect(host().textContent).toContain('geovana.medeiros');
  });

  it('a coluna de pessoas põe cada uma em sua linha, sem selo', () => {
    // Lado a lado, os nomes viram um texto corrido sem começo nem fim visível.
    renderPeople(['luma.silva', 'geovana.medeiros']);

    const celula = host().querySelector('tbody td');
    const nomes = [...(celula?.querySelectorAll('.ui-stacked-list__item') ?? [])].map((item) =>
      item.textContent?.trim(),
    );
    expect(nomes).toEqual(['luma.silva', 'geovana.medeiros']);
    expect(celula?.querySelector('app-badge')).toBeNull();
  });

  it('sem ninguém, a célula de pessoas fica com o rótulo do backend', () => {
    renderPeople([]);

    const celula = host().querySelector('tbody td');
    expect(celula?.textContent?.trim()).toBe('—');
    expect(celula?.querySelector('.ui-stacked-list')).toBeNull();
  });

  it('a tabela respeita a ordem escolhida, não a do backend', () => {
    const order = TestBed.inject(ColumnOrderService);
    order.registerColumns(COLUMNS.map((column) => column.key));
    order.move('author', -1);
    render();

    expect([...host().querySelectorAll('th')].map((th) => th.textContent?.trim())).toEqual([
      'Likes',
      'Autor',
      'MR',
      'Pipeline',
      'Atualizado',
    ]);
    // As células seguem o cabeçalho: a ordem vale para o corpo também.
    expect([...host().querySelectorAll('tbody td')].map((td) => td.textContent?.trim())[1]).toBe(
      'geovana.medeiros',
    );
  });

  it('a largura de cada coluna sai do peso informado pelo backend', () => {
    render();

    // 36 de um total de 95 pesos visíveis.
    const widths = [...host().querySelectorAll('col')].map((col) => col.getAttribute('style'));
    expect(widths[1]).toContain(`${(36 / 95) * 100}%`);
  });

  it('coluna oculta não existe no DOM, em vez de ficar escondida por CSS', () => {
    // Escondida por display:none, o <colgroup> desalinhava no Chromium.
    render([ROW], ['author']);

    const headers = [...host().querySelectorAll('th')].map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Likes', 'MR', 'Pipeline', 'Atualizado']);
    expect(host().querySelectorAll('col').length).toBe(4);
  });

  it('marca só as colunas que mudaram desde a última coleta', () => {
    render();

    const marks = [...host().querySelectorAll('app-changed-mark')].filter(
      (mark) => mark.children.length > 0,
    );
    expect(marks.length).toBe(1);
  });

  it('sem linhas, diz o motivo dentro da própria tabela', () => {
    // A tabela do DS mantém os cabeçalhos e põe o motivo numa linha só: some
    // o conteúdo, não a estrutura, então quem usa leitor de tela continua
    // sabendo onde está.
    render([]);

    expect(host().querySelectorAll('thead th').length).toBe(5);
    expect(host().querySelector('.ui-table__empty')?.textContent).toContain(
      'Nenhum MR aberto para este alvo.',
    );
  });

  it('a tabela tem legenda, cabeçalhos com escopo e área rolável alcançável pelo teclado', () => {
    render();

    const scroll = host().querySelector('.ui-table-wrapper');
    expect(scroll?.getAttribute('role')).toBe('region');
    expect(scroll?.getAttribute('tabindex')).toBe('0');
    expect(scroll?.getAttribute('aria-label')).toBe('Merge requests abertos');

    const caption = host().querySelector('caption');
    expect(caption?.classList).toContain('ui-visually-hidden');
    expect([...host().querySelectorAll('th')].every((th) => th.scope === 'col')).toBe(true);
  });

  it('o selo de likes carrega um rótulo que faz sentido sozinho', () => {
    // "3" sozinho não diz nada a quem usa leitor de tela.
    render();

    expect(host().querySelector('app-badge')?.getAttribute('aria-label')).toBe(
      '3 like(s), incluindo o seu',
    );
  });

  it('o selo de likes não desenha visto: o destaque é só o fundo', () => {
    render();

    const likes = host().querySelector('app-badge');
    expect(likes?.querySelector('app-icon[name="check"]')).toBeNull();
    expect(likes?.classList).toContain('ui-tag--strong');
  });

  it('o cabeçalho usa o idioma do painel, não o rótulo que veio do backend', () => {
    // O backend manda o rótulo em pt-BR porque é o que o terminal imprime;
    // na web quem manda é o catálogo.
    fixture.componentRef.setInput('columns', [
      { key: 'author', label: 'rótulo do terminal', cell: 'text', weight: 18 },
    ]);
    fixture.componentRef.setInput('rows', [ROW]);
    fixture.componentRef.setInput('emptyMessage', '');
    fixture.detectChanges();

    expect(host().querySelector('th')?.textContent?.trim()).toBe('Autor');
  });

  it('coluna sem tradução cai no rótulo do backend, não na chave crua', () => {
    // Uma coluna nova no gitlab_monitor.py aparece antes de existir no
    // catálogo: melhor o nome em pt-BR do que "columns.novidade" na tela.
    fixture.componentRef.setInput('columns', [
      { key: 'novidade', label: 'Novidade', cell: 'text', weight: 10 },
    ]);
    fixture.componentRef.setInput('rows', [ROW]);
    fixture.componentRef.setInput('emptyMessage', '');
    fixture.detectChanges();

    expect(host().querySelector('th')?.textContent?.trim()).toBe('Novidade');
  });

  it('reformata as células ao trocar de idioma, sem nova consulta', async () => {
    const agora = Date.now();
    const horas = (n: number): string => new Date(agora - n * 3_600_000).toISOString();
    const linha: MrRowModel = {
      ...ROW,
      cells: {
        ...ROW.cells,
        pipeline: { label: 'falhou', tone: 'danger', status: 'failed' },
        updated_label: { label: 'há 2 horas', iso: horas(2) },
        created_label: { label: '19/10/2026', iso: '2026-10-19T10:00:00Z' },
        threads: { label: '2/3 resolvidas', resolved: 2, total: 3 },
        mergeable: { label: 'bloqueado', value: false },
        conflicts: { label: 'sem conflito', value: false },
        openers: { label: 'ana.lima', names: ['ana.lima', 'bia.sa'] },
      },
    };
    fixture.componentRef.setInput('columns', [
      ...COLUMNS,
      { key: 'created_label', label: 'Criado', cell: 'text', weight: 14 },
      { key: 'threads', label: 'Threads', cell: 'badge', weight: 13 },
      { key: 'mergeable', label: 'Mergeável', cell: 'badge', weight: 13 },
      { key: 'conflicts', label: 'Conflitos', cell: 'badge', weight: 13 },
      { key: 'openers', label: 'Participantes', cell: 'text', weight: 20 },
    ]);
    fixture.componentRef.setInput('rows', [linha]);
    fixture.componentRef.setInput('emptyMessage', '');
    fixture.detectChanges();

    // O selo põe a primeira letra em maiúscula; a comparação ignora a caixa.
    const texto = (): string => (host().querySelector('tbody tr')?.textContent ?? '').toLowerCase();
    const nomeDoSeloDeThreads = (): string | null =>
      host().querySelector('tbody td[data-label="Threads"] .ui-tag')?.getAttribute('aria-label') ??
      null;
    expect(texto()).toContain('há 2 horas');
    expect(texto()).toContain('19/10/2026');
    // Na tela o selo de threads é só a contagem; a frase inteira fica no nome
    // acessível, porque "2/3" sozinho não diz o que é resolvido nem total.
    expect(texto()).toContain('2/3');
    expect(nomeDoSeloDeThreads()).toBe('2 de 3 resolvidas');
    expect(texto()).toContain('bloqueado');
    expect(texto()).toContain('sem conflito');
    expect(texto()).toContain('falhou');

    TestBed.inject(TranslateService).use('en');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto()).toContain('2 hours ago');
    expect(texto()).toContain('10/19/2026');
    expect(texto()).toContain('2/3');
    expect(nomeDoSeloDeThreads()).toBe('2 of 3 resolved');
    expect(texto()).toContain('blocked');
    expect(texto()).toContain('no conflicts');
    expect(texto()).toContain('failed');
    expect(texto()).not.toContain('há 2 horas');
    // A célula é a mesma linha: nenhuma consulta nova aconteceu.
    expect(fixture.componentInstance.rows()[0]).toBe(linha);
  });

  it('usa o rótulo do backend quando a chave não existe no catálogo', () => {
    // Um status novo do GitLab chega antes de existir no catálogo: melhor o
    // rótulo do backend do que "pipeline.inventado" na tela.
    const linha: MrRowModel = {
      ...ROW,
      cells: {
        ...ROW.cells,
        pipeline: { label: 'inventada', tone: null, status: 'inventado' },
      },
    };
    render([linha]);

    expect(host().textContent?.toLowerCase()).toContain('inventada');
    expect(host().textContent).not.toContain('pipeline.inventado');
  });

  it('quem deu like aparece empilhado na célula', () => {
    render();

    expect(host().querySelector('app-stacked-list')?.textContent).toContain('ana.lima');
  });

  it('a linha ganha o tom da primeira regra que casa com os fatos dela', () => {
    TestBed.inject(RowRulesService).add({
      field: 'pipeline',
      operator: 'eq',
      value: 'failed',
      tone: 'danger',
      markStyle: 'solid',
      enabled: true,
    });
    render([ROW, { ...ROW, facts: { ...ROW.facts, pipeline: 'success' } }]);

    const linhas = host().querySelectorAll('tbody tr');
    expect(linhas[0].classList).toContain('ui-table__row--tone-danger');
    expect([...linhas[1].classList].some((nome) => nome.includes('--tone-'))).toBe(false);
  });

  it('anuncia por texto qual regra destacou a linha', () => {
    TestBed.inject(RowRulesService).add({
      field: 'pipeline',
      operator: 'eq',
      value: 'failed',
      tone: 'danger',
      markStyle: 'solid',
      enabled: true,
    });
    render();

    const linha = host().querySelector('tbody tr') as HTMLElement;
    expect(linha.querySelector('.ui-visually-hidden')?.textContent).toContain('Pipeline falhou');
  });

  it('regra feita à mão é descrita por campo, operador e valor traduzidos', () => {
    TestBed.inject(RowRulesService).add({
      field: 'likes',
      operator: 'gte',
      value: '3',
      tone: 'strong',
      markStyle: 'dotted',
      enabled: true,
    });
    render();

    const texto = host().querySelector('tbody tr .ui-table__match')?.textContent ?? '';
    expect(texto).toContain('Likes');
    expect(texto).toContain('maior ou igual a');
    expect(texto).toContain('3');
  });

  it('a linha destacada não desenha ícone: o canal é a cor, o traço e o texto', () => {
    TestBed.inject(RowRulesService).add({
      field: 'pipeline',
      operator: 'eq',
      value: 'failed',
      tone: 'danger',
      markStyle: 'solid',
      enabled: true,
    });
    render();

    expect(fixture.debugElement.query(By.css('tbody tr .ui-table__match app-icon'))).toBeNull();
    expect(host().querySelector('tbody tr .ui-table__match')?.textContent).toContain(
      'Pipeline falhou',
    );
  });

  it('linha sem regra não ganha texto de destaque', () => {
    render();

    expect(host().querySelector('tbody tr .ui-table__match')).toBeNull();
  });

  it('o texto do destaque troca de idioma sem nova consulta', async () => {
    TestBed.inject(RowRulesService).add({
      field: 'pipeline',
      operator: 'eq',
      value: 'failed',
      tone: 'danger',
      markStyle: 'solid',
      enabled: true,
    });
    render();
    TestBed.inject(TranslateService).use('en');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host().querySelector('tbody tr .ui-table__match')?.textContent).toContain(
      'Pipeline failed',
    );
  });

  it('a linha recebe o tom e o traço da regra, que são eixos independentes', () => {
    TestBed.inject(RowRulesService).add({
      field: 'pipeline',
      operator: 'eq',
      value: 'failed',
      tone: 'neutral',
      markStyle: 'double',
      enabled: true,
    });
    render([ROW, { ...ROW, facts: { ...ROW.facts, pipeline: 'success' } }]);

    const linhas = host().querySelectorAll('tbody tr');
    expect(linhas[0].classList).toContain('ui-table__row--tone-neutral');
    expect(linhas[0].classList).toContain('ui-table__row--mark-double');
    expect([...linhas[1].classList].some((nome) => nome.includes('--mark-'))).toBe(false);
  });

  it('o traço ausente cai no padrão do tom', async () => {
    // Regra guardada sem traço: só o arquivo de preferências produz esse
    // estado, porque `add()` exige o traço. `rowRules` é lido na construção do
    // serviço, então o store tem de nascer semeado.
    await recreateWith({
      rowRules: [
        {
          id: 'a',
          field: 'pipeline',
          operator: 'eq',
          value: 'failed',
          tone: 'success',
          enabled: true,
        },
      ],
    });
    render();

    // `success` desenhava `double` antes de cor e traço se separarem.
    expect(host().querySelector('tbody tr')?.classList).toContain('ui-table__row--mark-double');
  });

  it('a cor e o traço da linha são os da primeira regra que casa', () => {
    adicionarDuasRegras('danger', 'strong');
    render();

    const linha = host().querySelector('tbody tr') as HTMLElement;
    expect(linha.classList).toContain('ui-table__row--tone-danger');
    expect(linha.classList).toContain('ui-table__row--mark-solid');
    expect(linha.classList).not.toContain('ui-table__row--tone-strong');
  });

  it('o texto acessível lista todas as regras casadas', () => {
    adicionarDuasRegras('danger', 'strong');
    render();

    const texto = host().querySelector('tbody tr .ui-table__match')?.textContent ?? '';
    expect(texto).toContain('Pipeline falhou');
    expect(texto).toContain('Likes');
    expect(texto).toContain('maior ou igual a');
    // O prefixo aparece uma só vez, com as regras unidas dentro dele.
    expect(texto.match(/Destaque:/g)).toHaveLength(1);
  });

  it('sem regra, nenhuma linha ganha tom', () => {
    render();

    expect(host().querySelector('[class*="--tone-"]')).toBeNull();
  });
});

describe('MrTableComponent: ordenação pelo cabeçalho', () => {
  let fixture: ComponentFixture<MrTableComponent>;
  const host = (): HTMLElement => fixture.nativeElement;
  const header = (nome: string): HTMLElement | undefined =>
    [...host().querySelectorAll<HTMLElement>('th')].find((th) => th.textContent?.includes(nome));

  const SORTS: readonly SortOptionModel[] = [
    { value: 'likes', label: 'Mais likes', column: 'likes', direction: 'desc' },
    { value: 'author', label: 'Autor (A–Z)', column: 'author', direction: 'asc' },
  ];

  const render = (sort = ''): void => {
    fixture.componentRef.setInput('columns', COLUMNS);
    fixture.componentRef.setInput('rows', [ROW]);
    fixture.componentRef.setInput('sorts', SORTS);
    fixture.componentRef.setInput('sort', sort);
    fixture.componentRef.setInput('direction', null);
    fixture.componentRef.setInput('emptyMessage', '');
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MrTableComponent],
      providers: [provideTestTranslate()],
    }).compileComponents();
    fixture = TestBed.createComponent(MrTableComponent);
  });

  it('só ordena pelo cabeçalho a coluna que tem ordenação correspondente', () => {
    render();

    expect(header('Likes')?.querySelector('button')).not.toBeNull();
    expect(header('Autor')?.querySelector('button')).not.toBeNull();
    // MR e Pipeline não estão na lista de ordenações deste teste.
    expect(header('MR')?.querySelector('button')).toBeNull();
    expect(header('Pipeline')?.querySelector('button')).toBeNull();
  });

  it('a seta marca a coluna da ordenação em uso, no sentido que o backend usa', () => {
    render('likes');

    expect(header('Likes')?.getAttribute('aria-sort')).toBe('descending');
    expect(header('Autor')?.getAttribute('aria-sort')).toBeNull();

    render('author');
    expect(header('Autor')?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('clicar no cabeçalho pede a ordenação daquela coluna, no sentido natural', () => {
    render();
    const pedidas: SortRequest[] = [];
    fixture.componentInstance.sortChange.subscribe((value) => pedidas.push(value));

    header('Autor')?.querySelector('button')?.click();

    expect(pedidas).toEqual([{ value: 'author', direction: null }]);
  });

  it('clicar de novo na mesma coluna inverte o sentido, e de novo volta', () => {
    // Quem ordena é o backend, mas o sentido é de quem olha.
    render('likes');
    const pedidas: SortRequest[] = [];
    fixture.componentInstance.sortChange.subscribe((value) => pedidas.push(value));

    header('Likes')?.querySelector('button')?.click();
    // O sentido pedido volta como entrada, como a página faz depois de salvar.
    fixture.componentRef.setInput('direction', 'asc');
    fixture.detectChanges();
    expect(header('Likes')?.getAttribute('aria-sort')).toBe('ascending');

    header('Likes')?.querySelector('button')?.click();

    expect(pedidas).toEqual([
      { value: 'likes', direction: 'asc' },
      { value: 'likes', direction: 'desc' },
    ]);
  });

  it('trocar de coluna recomeça no sentido natural da nova ordenação', () => {
    render('likes');
    fixture.componentRef.setInput('direction', 'asc');
    fixture.detectChanges();
    const pedidas: SortRequest[] = [];
    fixture.componentInstance.sortChange.subscribe((value) => pedidas.push(value));

    header('Autor')?.querySelector('button')?.click();

    expect(pedidas).toEqual([{ value: 'author', direction: null }]);
  });

  it('ordenação sem coluna correspondente não marca cabeçalho nenhum', () => {
    render('recent');

    expect([...host().querySelectorAll('th')].every((th) => !th.getAttribute('aria-sort'))).toBe(
      true,
    );
  });
});
