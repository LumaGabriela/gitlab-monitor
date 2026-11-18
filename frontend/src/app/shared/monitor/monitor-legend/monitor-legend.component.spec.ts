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
    enabled: true,
  },
  { id: 'b', field: 'likes', operator: 'gte', value: '3', tone: 'success', enabled: true },
  { id: 'c', field: 'draft', operator: 'eq', value: 'true', tone: 'warning', enabled: false },
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

  it('lista uma entrada por regra ligada, com o marcador correspondente', () => {
    render(RULES);

    const entradas = host().querySelectorAll('.ui-legend__rule');
    expect(entradas.length).toBe(2);
    // `name` é um input, não um atributo do DOM: lê-se do componente.
    const icones = fixture.debugElement.queryAll(By.css('.ui-legend__rule app-icon'));
    const icone = (indice: number): string => icones[indice].componentInstance.name();
    expect(icone(0)).toBe('error');
    expect(entradas[0].textContent).toContain('Pipeline falhou');
    expect(icone(1)).toBe('check');
    expect(entradas[1].textContent).toContain('Likes');
  });

  it('sem regra ligada, só explica a marca de alteração', () => {
    render([]);

    expect(host().querySelectorAll('.ui-legend__rule').length).toBe(0);
    expect(host().querySelector('.ui-changed-mark')).not.toBeNull();
  });
});
