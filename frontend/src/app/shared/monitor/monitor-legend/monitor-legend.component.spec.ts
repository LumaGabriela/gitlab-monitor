import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HighlightRule } from '../../../core/rules/rule-engine';
import { MonitorLegendComponent } from './monitor-legend.component';
import { provideTestTranslate } from '../../../../testing/translate';

const RULES: readonly HighlightRule[] = [
  {
    id: 'a',
    field: 'pipeline',
    operator: 'eq',
    value: 'failed',
    tone: 'danger',
    markStyle: 'solid',
    enabled: true,
  },
  {
    id: 'b',
    field: 'likes',
    operator: 'gte',
    value: '3',
    tone: 'success',
    markStyle: 'double',
    enabled: true,
  },
  {
    id: 'c',
    field: 'draft',
    operator: 'eq',
    value: 'true',
    tone: 'warning',
    markStyle: 'dashed',
    enabled: false,
  },
];

describe('MonitorLegendComponent', () => {
  let fixture: ComponentFixture<MonitorLegendComponent>;
  const host = (): HTMLElement => fixture.nativeElement;

  const render = (rules: readonly HighlightRule[]): void => {
    fixture.componentRef.setInput('rules', rules);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MonitorLegendComponent],
      providers: [provideTestTranslate()],
    }).compileComponents();
    fixture = TestBed.createComponent(MonitorLegendComponent);
  });

  it('lista uma entrada por regra ligada, só com o nome da regra', () => {
    render(RULES);

    const entradas = host().querySelectorAll('.ui-legend__rule');
    expect(entradas.length).toBe(2);
    // Sem ícone: a linha destacada também não tem um, e a legenda repete o que a tabela mostra.
    expect(fixture.debugElement.queryAll(By.css('.ui-legend__rule app-icon'))).toEqual([]);
    // Sem o "Destaque:": a legenda inteira já diz do que se trata.
    expect(entradas[0].textContent?.trim()).toBe('Pipeline falhou');
    expect(entradas[1].textContent).toContain('Likes');
    expect(entradas[1].textContent).not.toContain('Destaque');
  });

  it('cada entrada traz as classes de cor e de traço que a linha destacada desenha', () => {
    render(RULES);

    const entradas = host().querySelectorAll('.ui-legend__rule');
    // A borda da legenda é a mesma da linha: a cor sai do tom e o traço, do markStyle.
    expect(entradas[0].classList).toContain('ui-legend__rule--tone-danger');
    expect(entradas[0].classList).toContain('ui-legend__rule--mark-solid');
    expect(entradas[1].classList).toContain('ui-legend__rule--tone-success');
    expect(entradas[1].classList).toContain('ui-legend__rule--mark-double');
    // Um eixo não arrasta o outro: nada da regra desligada, e nenhum traço alheio.
    expect([...entradas[0].classList].filter((nome) => nome.includes('--mark-'))).toEqual([
      'ui-legend__rule--mark-solid',
    ]);
    expect([...entradas[1].classList].filter((nome) => nome.includes('--tone-'))).toEqual([
      'ui-legend__rule--tone-success',
    ]);
  });

  it('o traço ausente na regra guardada vira o padrão do tom na legenda', () => {
    // Regra vinda do arquivo sem `markStyle`: o tipo não deixa omitir, e o que
    // o `markStyleOf` resolve é o que a legenda tem de desenhar.
    const semTraco = { ...RULES[1], markStyle: undefined } as unknown as HighlightRule;
    render([semTraco]);

    expect(host().querySelector('.ui-legend__rule')?.classList).toContain(
      'ui-legend__rule--mark-double',
    );
  });

  it('sem regra ligada, só explica a marca de alteração', () => {
    render([]);

    expect(host().querySelectorAll('.ui-legend__rule').length).toBe(0);
    expect(host().querySelector('.ui-changed-mark')).not.toBeNull();
  });
});
