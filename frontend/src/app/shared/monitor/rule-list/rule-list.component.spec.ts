import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RULE_FIELDS, RuleField } from '../../../core/rules/rule-engine';
import { RuleDraft, RuleListContext, RuleOption } from '../../../core/services/rule-editor.service';
import { chooseValue, selectIn } from '../../../../testing/select';
import { provideTestTranslate } from '../../../../testing/translate';
import { EditableRule, RuleChange, RuleListComponent } from './rule-list.component';

const RULE: EditableRule = {
  id: 'r1',
  field: 'pipeline',
  operator: 'eq',
  value: 'failed',
  tone: 'danger',
  markStyle: 'dotted',
  enabled: true,
};

const option = (value: string): RuleOption => ({ value, label: value });

function context(overrides: Partial<RuleListContext> = {}): RuleListContext {
  return {
    total: 4,
    fieldOptions: RULE_FIELDS.map(option),
    toneOptions: ['danger', 'success'].map(option),
    markStyleOptions: ['solid', 'dotted'].map(option),
    modeOptions: ['notify', 'mute'].map(option),
    kindOptions: ['opened', 'likes'].map(option),
    operatorOptions: (field: RuleField): readonly RuleOption[] =>
      (field === 'likes' ? ['gte', 'lte', 'eq', 'neq'] : ['eq', 'neq']).map(option),
    valueChoices: (): readonly RuleOption[] | null => null,
    valueHint: (): string | null => null,
    isNumber: (field: RuleField): boolean => field === 'likes',
    matchCount: (): number => 2,
    coveredCount: (above: readonly RuleDraft[]): number => (above.length ? 1 : 0),
    ...overrides,
  };
}

describe('RuleListComponent', () => {
  let fixture: ComponentFixture<RuleListComponent>;
  const host = (): HTMLElement => fixture.nativeElement;
  const emitted: RuleChange[] = [];

  function render(
    inputs: {
      rules?: readonly EditableRule[];
      context?: RuleListContext;
      appearance?: boolean;
      showMode?: boolean;
      showKinds?: boolean;
      ordered?: boolean;
    } = {},
  ): void {
    fixture.componentRef.setInput('rules', inputs.rules ?? [RULE]);
    fixture.componentRef.setInput('context', inputs.context ?? context());
    fixture.componentRef.setInput('appearance', inputs.appearance ?? false);
    fixture.componentRef.setInput('showMode', inputs.showMode ?? false);
    fixture.componentRef.setInput('showKinds', inputs.showKinds ?? false);
    fixture.componentRef.setInput('ordered', inputs.ordered ?? false);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    emitted.length = 0;
    await TestBed.configureTestingModule({
      imports: [RuleListComponent],
      providers: [provideTestTranslate()],
    }).compileComponents();
    fixture = TestBed.createComponent(RuleListComponent);
    fixture.componentInstance.ruleChange.subscribe((change: RuleChange) => emitted.push(change));
  });

  it('desenha um bloco por regra, com o selo de quantas casam agora', () => {
    render({ rules: [RULE, { ...RULE, id: 'r2' }] });

    expect(host().querySelectorAll('[data-rule]').length).toBe(2);
    expect(host().querySelector('[data-test="rule-matches"]')!.textContent).toContain(
      'Casa com 2 de 4',
    );
  });

  describe('cobertura', () => {
    const badge = (id: string): string =>
      host().querySelector(`[data-rule="${id}"] [data-test="rule-matches"]`)!.textContent!;

    it('o selo não mostra cobertos quando não há nenhum', () => {
      render({ rules: [RULE, { ...RULE, id: 'r2' }], ordered: true });

      expect(badge('r1')).not.toContain('cobertos');
    });

    it('o selo mostra os cobertos por uma regra ligada acima', () => {
      render({ rules: [RULE, { ...RULE, id: 'r2' }], ordered: true });

      expect(badge('r2')).toContain('Casa com 2 de 4');
      expect(badge('r2')).toContain('1 coberto(s) por uma regra acima');
    });

    it('regra desligada acima não cobre', () => {
      render({ rules: [{ ...RULE, enabled: false }, { ...RULE, id: 'r2' }], ordered: true });

      expect(badge('r2')).not.toContain('cobertos');
    });

    it('sem ordered a ordem não é precedência e nada é coberto', () => {
      render({ rules: [RULE, { ...RULE, id: 'r2' }] });

      expect(badge('r2')).not.toContain('cobertos');
    });

    it('o selo diz que não pinta nada quando todos os casados estão cobertos', () => {
      render({
        rules: [RULE, { ...RULE, id: 'r2' }],
        ordered: true,
        context: context({ coveredCount: (): number => 2 }),
      });

      expect(badge('r2')).toContain('Não pinta nada: tudo o que casa (2) já é pintado acima');
      expect(badge('r2')).not.toContain('Casa com');
    });
  });

  it('sem MR em tela não há selo', () => {
    render({ context: context({ total: 0 }) });

    expect(host().querySelector('[data-test="rule-matches"]')).toBeNull();
  });

  it('esconde Cor e Traço quando appearance é falso', () => {
    render({ appearance: false });

    expect(host().querySelector('[data-test="rule-tone"]')).toBeNull();
    expect(host().querySelector('[data-test="rule-mark"]')).toBeNull();
  });

  it('mostra Cor e Traço quando appearance é verdadeiro', () => {
    render({ appearance: true });

    expect(selectIn(fixture, 'rule-tone').value()).toBe('danger');
    expect(selectIn(fixture, 'rule-mark').value()).toBe('dotted');
  });

  it('esconde o select de modo e o de tipos quando showMode e showKinds são falsos', () => {
    render();

    expect(host().querySelector('[data-test="rule-mode"]')).toBeNull();
    expect(host().querySelector('[data-test="rule-kinds"]')).toBeNull();
  });

  it('mostra o select de modo e o de tipos quando showMode e showKinds são verdadeiros', () => {
    render({
      rules: [{ ...RULE, mode: 'mute', kinds: ['likes'] }],
      showMode: true,
      showKinds: true,
    });

    expect(selectIn(fixture, 'rule-mode').value()).toBe('mute');
    expect(host().querySelector('[data-test="rule-kinds"]')).not.toBeNull();
  });

  it('emite field, operator e value ao trocar de campo', async () => {
    render();

    await chooseValue(fixture, selectIn(fixture, 'rule-field'), 'likes');

    expect(emitted).toEqual([{ id: 'r1', patch: { field: 'likes', operator: 'eq', value: '' } }]);
  });

  it('trocar para um campo que não aceita o operador cai em igualdade', async () => {
    render({ rules: [{ ...RULE, field: 'likes', operator: 'gte', value: '3' }] });

    await chooseValue(fixture, selectIn(fixture, 'rule-field'), 'pipeline');

    expect(emitted).toEqual([
      { id: 'r1', patch: { field: 'pipeline', operator: 'eq', value: '' } },
    ]);
  });

  it('emite só o traço ao trocar o traço, sem tocar no tom', async () => {
    render({ appearance: true });

    await chooseValue(fixture, selectIn(fixture, 'rule-mark'), 'solid');

    expect(emitted).toEqual([{ id: 'r1', patch: { markStyle: 'solid' } }]);
  });

  it('desenha o valor como texto livre quando o contexto não oferece opções', () => {
    render();

    expect(host().querySelector('[data-test="rule-value"] input')).not.toBeNull();
  });

  it('desenha o valor como lista quando o contexto oferece opções', () => {
    render({ context: context({ valueChoices: () => [option('failed'), option('success')] }) });

    expect(host().querySelector('[data-test="rule-value"] input')).toBeNull();
    expect(
      selectIn(fixture, 'rule-value')
        .options()
        .map((o) => o.value),
    ).toEqual(['failed', 'success']);
  });

  it('mostra o estado vazio quando não há regra', () => {
    fixture.componentRef.setInput('emptyMessage', 'Nada por aqui');
    render({ rules: [] });

    expect(host().querySelector('[data-rule]')).toBeNull();
    expect(host().querySelector('app-empty-state')!.textContent).toContain('Nada por aqui');
  });

  it('aplica no bloco a classe do tom e a do traço da regra', () => {
    render();

    const block = host().querySelector('[data-rule="r1"]')!;
    expect(block.classList).toContain('ui-rule-list__rule--tone-danger');
    expect(block.classList).toContain('ui-rule-list__rule--mark-dotted');
  });

  it('sem traço guardado, o bloco usa o traço padrão do tom', () => {
    render({ rules: [{ ...RULE, markStyle: undefined }] });

    expect(host().querySelector('[data-rule="r1"]')!.classList).toContain(
      'ui-rule-list__rule--mark-solid',
    );
  });

  it('remover e adicionar emitem o pedido certo', () => {
    const removed: string[] = [];
    let added = 0;
    fixture.componentInstance.ruleRemove.subscribe((id: string) => removed.push(id));
    fixture.componentInstance.ruleAdd.subscribe(() => (added += 1));
    render();

    host().querySelector<HTMLButtonElement>('[data-test="rule-remove"]')!.click();
    host().querySelector<HTMLButtonElement>('[data-test="rule-add"]')!.click();

    expect(removed).toEqual(['r1']);
    expect(added).toBe(1);
  });

  describe('ordered', () => {
    const TRIO: readonly EditableRule[] = [
      { ...RULE, id: 'a' },
      { ...RULE, id: 'b' },
      { ...RULE, id: 'c' },
    ];
    const moveButton = (id: string, delta: string): HTMLButtonElement =>
      host().querySelector<HTMLButtonElement>(`[data-rule="${id}"] [data-move="${delta}"]`)!;

    it('sem ordered não desenha posição nem setas', () => {
      render({ rules: TRIO });

      expect(host().querySelector('[data-test="rule-position"]')).toBeNull();
      expect(host().querySelector('[data-move]')).toBeNull();
    });

    it('com ordered desenha a posição de cada regra', () => {
      render({ rules: TRIO, ordered: true });

      const positions = Array.from(
        host().querySelectorAll('[data-test="rule-position"]'),
        (el) => el.textContent!.trim(),
      );
      expect(positions).toEqual(['1', '2', '3']);
    });

    it('a posição tem nome acessível em texto, e o dígito some para o leitor de tela', () => {
      render({ rules: TRIO, ordered: true });

      const digit = host().querySelector('[data-test="rule-position"]')!;
      const sentence = host().querySelector('[data-test="rule-position-label"]')!;
      expect(digit.getAttribute('aria-hidden')).toBe('true');
      expect(digit.hasAttribute('aria-label')).toBe(false);
      expect(sentence.classList).toContain('ui-visually-hidden');
      expect(sentence.textContent!.trim()).toBe('Regra 1 de 3');
    });

    it('com ordered a seta de subir da primeira vem desabilitada', () => {
      render({ rules: TRIO, ordered: true });

      expect(moveButton('a', '-1').disabled).toBe(true);
      expect(moveButton('b', '-1').disabled).toBe(false);
    });

    it('com ordered a seta de descer da última vem desabilitada', () => {
      render({ rules: TRIO, ordered: true });

      expect(moveButton('c', '1').disabled).toBe(true);
      expect(moveButton('b', '1').disabled).toBe(false);
    });

    it('clicar na seta emite moveRule com o id e o delta', () => {
      const moves: { id: string; delta: -1 | 1 }[] = [];
      fixture.componentInstance.moveRule.subscribe((m) => moves.push(m));
      render({ rules: TRIO, ordered: true });

      moveButton('b', '1').click();
      moveButton('b', '-1').click();

      expect(moves).toEqual([
        { id: 'b', delta: 1 },
        { id: 'b', delta: -1 },
      ]);
    });
  });
});
