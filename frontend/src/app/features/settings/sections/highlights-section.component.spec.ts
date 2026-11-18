import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';
import { MrRowModel, RowFactsModel } from '../../../core/models/api/panel-api.model';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { RowRulesService } from '../../../core/services/row-rules.service';
import { HighlightRule } from '../../../core/rules/rule-engine';
import { chooseValue, selectIn } from '../../../../testing/select';
import { HighlightsSectionComponent } from './highlights-section.component';

const RULE: HighlightRule = {
  id: 'r1',
  field: 'pipeline',
  operator: 'eq',
  value: 'failed',
  tone: 'danger',
  enabled: true,
};

const FACTS: RowFactsModel = {
  likes: 0,
  unresolved: 0,
  participants: 0,
  mergeable: true,
  conflicts: false,
  pipeline: 'success',
  author: 'ana',
  mine: false,
  involved: false,
  draft: false,
  ageHours: 10,
  idleHours: 4,
  assignedToMe: false,
  reviewingMine: false,
  myReviewState: '',
  assignees: 0,
  reviewers: 0,
};

function row(facts: Partial<RowFactsModel>): MrRowModel {
  return { cells: {}, facts: { ...FACTS, ...facts }, changed: [] };
}

describe('HighlightsSectionComponent', () => {
  let fixture: ComponentFixture<HighlightsSectionComponent>;
  const host = (): HTMLElement => fixture.nativeElement;
  const status = (): string => host().querySelector('[role="status"]')?.textContent?.trim() ?? '';

  let service: RowRulesService;
  let rows: WritableSignal<readonly MrRowModel[]>;

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    rows = signal<readonly MrRowModel[]>([]);
    const store = new FakePreferencesStore({ rowRules: [RULE] });
    await TestBed.configureTestingModule({
      imports: [HighlightsSectionComponent],
      providers: [
        provideTestTranslate(),
        provideHttpClient(),
        provideHttpClientTesting(),
        providePreferences(store),
        { provide: GitlabMonitorService, useValue: { rows } as unknown as GitlabMonitorService },
      ],
    }).compileComponents();
    service = TestBed.inject(RowRulesService);
    fixture = TestBed.createComponent(HighlightsSectionComponent);
    fixture.detectChanges();
  });

  it('a regra aparece com os rótulos traduzidos, e o aviso existe vazio', () => {
    const campo = selectIn(fixture, 'rule-field');
    expect(campo.value()).toBe('pipeline');
    expect(campo.options().map((o) => o.label)).toContain('Sem atualização (horas)');
    expect(host().querySelector('[role="status"]')).not.toBeNull();
    expect(status()).toBe('');
  });

  it('a comparação só oferece o que o tipo do campo sabe comparar', async () => {
    expect(
      selectIn(fixture, 'rule-operator')
        .options()
        .map((o) => o.value),
    ).toEqual(['eq', 'neq']);

    await chooseValue(fixture, selectIn(fixture, 'rule-field'), 'likes');

    expect(
      selectIn(fixture, 'rule-operator')
        .options()
        .map((o) => o.value),
    ).toEqual(['gte', 'lte', 'eq', 'neq']);
  });

  it('trocar o campo mantém a comparação que serve e recomeça o valor', async () => {
    const update = vi.spyOn(service, 'update');

    await chooseValue(fixture, selectIn(fixture, 'rule-field'), 'likes');

    expect(update.mock.calls).toEqual([['r1', { field: 'likes', operator: 'eq', value: '' }]]);
  });

  it('campo booleano escolhe o valor em sim ou não, já em sim', async () => {
    await chooseValue(fixture, selectIn(fixture, 'rule-field'), 'conflicts');

    const valor = selectIn(fixture, 'rule-value');
    expect(valor.value()).toBe('true');
    expect(valor.options().map((o) => o.label)).toEqual(['Sim', 'Não']);
  });

  it('sem linha coletada o valor é texto livre; com linhas, vira a lista do que o GitLab devolveu', () => {
    expect(host().querySelector('[data-test="rule-value"] input')).not.toBeNull();

    rows.set([row({ pipeline: 'failed' }), row({ pipeline: 'running' }), row({})]);
    fixture.detectChanges();

    expect(host().querySelector('[data-test="rule-value"] input')).toBeNull();
    expect(
      selectIn(fixture, 'rule-value')
        .options()
        .map((o) => o.value),
    ).toEqual(['failed', 'running', 'success']);
    // O rótulo é o do catálogo, não o valor cru do GitLab.
    expect(selectIn(fixture, 'rule-value').options()[0].label).toBe('falhou');
  });

  it('campo de número só aceita dígitos no valor', async () => {
    await chooseValue(fixture, selectIn(fixture, 'rule-field'), 'likes');

    const valor = host().querySelector<HTMLInputElement>('[data-test="rule-value"] input')!;
    expect(valor.inputMode).toBe('numeric');

    valor.value = '1a0';
    valor.setSelectionRange(3, 3);
    valor.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(valor.value).toBe('10');
  });

  it('o selo diz quantos MRs a regra casa agora', () => {
    expect(host().querySelector('[data-test="rule-matches"]')).toBeNull();

    rows.set([row({ pipeline: 'failed' }), row({})]);
    fixture.detectChanges();

    expect(host().querySelector('[data-test="rule-matches"]')!.textContent).toContain(
      'Casa com 1 de 2',
    );
  });

  it('mudar o valor avisa quem decide e anuncia que salvou', () => {
    const update = vi.spyOn(service, 'update');

    const valor = host().querySelector<HTMLInputElement>('[data-test="rule-value"] input')!;
    valor.value = 'success';
    valor.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(update.mock.calls).toEqual([['r1', { value: 'success' }]]);
    vi.advanceTimersByTime(150);
    fixture.detectChanges();
    expect(status()).toBe('Alteração salva.');
  });

  it('o aviso some e volta a cada alteração, para o leitor de tela anunciar de novo', () => {
    const valor = host().querySelector<HTMLInputElement>('[data-test="rule-value"] input')!;
    const alterar = (texto: string): void => {
      valor.value = texto;
      valor.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };

    alterar('a');
    vi.advanceTimersByTime(150);
    fixture.detectChanges();
    expect(status()).toBe('Alteração salva.');

    alterar('b');
    expect(status()).toBe('');
    vi.advanceTimersByTime(150);
    fixture.detectChanges();
    expect(status()).toBe('Alteração salva.');

    vi.advanceTimersByTime(3500);
    fixture.detectChanges();
    expect(status()).toBe('');
  });

  it('trocar a cor e remover emitem o pedido certo', async () => {
    const update = vi.spyOn(service, 'update');
    const remove = vi.spyOn(service, 'remove');

    await chooseValue(fixture, selectIn(fixture, 'rule-tone'), 'success');
    host().querySelector<HTMLButtonElement>('[data-test="rule-remove"]')!.click();

    expect(update.mock.calls).toEqual([['r1', { tone: 'success' }]]);
    expect(remove).toHaveBeenCalledWith('r1');
  });

  it('"Adicionar regra" cria uma regra sem valor, que não casa com nada', () => {
    const add = vi.spyOn(service, 'add');

    host().querySelector<HTMLButtonElement>('[data-test="rule-add"]')!.click();

    expect(add.mock.calls.map((c) => c[0])).toEqual([
      { field: 'likes', operator: 'gte', value: '', tone: 'warning', enabled: true },
    ]);
  });

  it('cada sugestão cria a regra pronta', () => {
    const add = vi.spyOn(service, 'add');

    const botoes = host().querySelectorAll<HTMLButtonElement>('[data-suggestion]');
    botoes.forEach((botao) => botao.click());

    const criadas = add.mock.calls.map((c) => c[0]);
    expect(botoes.length).toBe(6);
    expect(criadas[0]).toMatchObject({ field: 'pipeline', value: 'failed' });
    expect(criadas[5]).toMatchObject({
      field: 'myReviewState',
      operator: 'eq',
      value: 'unreviewed',
    });
    expect(criadas[3]).toMatchObject({ field: 'idleHours', value: '72' });
  });
});
