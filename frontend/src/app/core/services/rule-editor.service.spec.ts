import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { provideTestTranslate } from '../../../testing/translate';
import { MrRowModel, RowFactsModel } from '../models/api/panel-api.model';
import { RuleDraft, RuleEditorService, RuleListContext } from './rule-editor.service';
import { GitlabMonitorService } from './gitlab-monitor.service';

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

describe('RuleEditorService', () => {
  let rows: WritableSignal<readonly MrRowModel[]>;
  const context = (): RuleListContext => TestBed.inject(RuleEditorService).context();
  const values = (options: readonly { value: string }[] | null): string[] | null =>
    options && options.map((option) => option.value);

  beforeEach(() => {
    rows = signal<readonly MrRowModel[]>([
      row({ likes: 1, author: 'caio', pipeline: 'failed' }),
      row({ likes: 5, author: 'ana', pipeline: 'success' }),
      row({ likes: 3, author: 'caio', pipeline: 'failed' }),
    ]);
    TestBed.configureTestingModule({
      providers: [
        provideTestTranslate(),
        { provide: GitlabMonitorService, useValue: { rows } as unknown as GitlabMonitorService },
      ],
    });
  });

  it('oferece só os operadores que o tipo do campo compara', () => {
    expect(values(context().operatorOptions('author'))).toEqual(['eq', 'neq']);
    expect(values(context().operatorOptions('likes'))).toEqual(['gte', 'lte', 'eq', 'neq']);
  });

  it('sugere os valores de texto que as linhas em tela mostram, em ordem', () => {
    const draft: RuleDraft = { field: 'author', operator: 'eq', value: '' };

    expect(values(context().valueChoices(draft))).toEqual(['ana', 'caio']);
  });

  it('mantém o valor guardado entre as sugestões mesmo que nenhuma linha o mostre', () => {
    const draft: RuleDraft = { field: 'author', operator: 'eq', value: 'zeca' };

    expect(values(context().valueChoices(draft))).toEqual(['zeca', 'ana', 'caio']);
  });

  it('acrescenta os estados de revisão do GitLab às sugestões de myReviewState', () => {
    rows.set([row({ myReviewState: 'review_started' })]);
    const draft: RuleDraft = { field: 'myReviewState', operator: 'eq', value: '' };

    const choices = values(context().valueChoices(draft));

    expect(choices).toContain('approved');
    expect(choices).toContain('requested_changes');
    expect(choices).toContain('review_started');
  });

  it('devolve sim ou não para campo booleano', () => {
    const draft: RuleDraft = { field: 'draft', operator: 'eq', value: '' };

    expect(values(context().valueChoices(draft))).toEqual(['true', 'false']);
  });

  it('devolve null para campo de texto sem nenhum valor observado', () => {
    rows.set([]);
    const draft: RuleDraft = { field: 'author', operator: 'eq', value: '' };

    expect(context().valueChoices(draft)).toBeNull();
  });

  it('dá a faixa observada como ajuda do campo numérico', () => {
    expect(context().valueHint('likes')).toBe('Nos MRs agora: 1 a 5');
    expect(context().valueHint('author')).toBeNull();
    rows.set([]);
    expect(context().valueHint('likes')).toBeNull();
  });

  it('sabe quais campos são número', () => {
    expect(context().isNumber('likes')).toBe(true);
    expect(context().isNumber('author')).toBe(false);
  });

  it('conta quantas linhas em tela a comparação casa', () => {
    const ctx = context();

    expect(ctx.total).toBe(3);
    expect(ctx.matchCount({ field: 'pipeline', operator: 'eq', value: 'failed' })).toBe(2);
    expect(ctx.matchCount({ field: 'likes', operator: 'gte', value: '3' })).toBe(2);
    expect(ctx.matchCount({ field: 'author', operator: 'eq', value: '' })).toBe(0);
  });

  it('coveredCount com above vazio é zero', () => {
    const draft: RuleDraft = { field: 'pipeline', operator: 'eq', value: 'failed' };

    expect(context().coveredCount([], draft)).toBe(0);
  });

  it('coveredCount conta só os que a de cima também casa', () => {
    const draft: RuleDraft = { field: 'pipeline', operator: 'eq', value: 'failed' };
    const above: RuleDraft = { field: 'likes', operator: 'gte', value: '3' };

    // Falhas: likes 1 e 3; a de cima casa likes >= 3, então cobre só uma.
    expect(context().coveredCount([above], draft)).toBe(1);
  });

  it('coveredCount é zero quando a de cima casa outras linhas', () => {
    const draft: RuleDraft = { field: 'pipeline', operator: 'eq', value: 'failed' };
    const above: RuleDraft = { field: 'author', operator: 'eq', value: 'ana' };

    expect(context().coveredCount([above], draft)).toBe(0);
  });

  it('oferece uma opção por valor de cada vocabulário', () => {
    const ctx = context();

    expect(values(ctx.toneOptions)).toEqual([
      'danger',
      'warning',
      'success',
      'strong',
      'info',
      'neutral',
    ]);
    expect(values(ctx.markStyleOptions)).toEqual(['solid', 'dashed', 'dotted', 'double']);
    expect(values(ctx.modeOptions)).toEqual(['notify', 'mute']);
    expect(values(ctx.kindOptions)).toEqual([
      'opened',
      'likes',
      'pipeline',
      'threads',
      'left',
      'review',
    ]);
    expect(ctx.fieldOptions.length).toBeGreaterThan(10);
  });

  it('traduz os rótulos que o catálogo tem', () => {
    const ctx = context();

    expect(ctx.fieldOptions.find((o) => o.value === 'likes')?.label).toBe('Likes');
    expect(ctx.kindOptions.find((o) => o.value === 'opened')?.label).toBe('MR novo');
  });

  it('refaz os rótulos quando o idioma muda', async () => {
    const service = TestBed.inject(RuleEditorService);
    const translate = TestBed.inject(TranslateService);
    await new Promise<void>((resolve) => translate.use('pt').subscribe(() => resolve()));
    const antes = service.context().kindOptions.find((o) => o.value === 'opened')?.label;

    await new Promise<void>((resolve) => translate.use('en').subscribe(() => resolve()));
    const depois = service.context().kindOptions.find((o) => o.value === 'opened')?.label;

    expect(antes).toBe('MR novo');
    expect(depois).not.toBe(antes);
  });

  it('acompanha as linhas: o total e a contagem mudam com elas', () => {
    const service = TestBed.inject(RuleEditorService);
    expect(service.context().total).toBe(3);

    rows.set([row({ likes: 9 })]);

    expect(service.context().total).toBe(1);
  });
});
