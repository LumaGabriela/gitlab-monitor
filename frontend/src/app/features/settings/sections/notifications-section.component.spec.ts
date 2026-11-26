import type { MockInstance } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { By } from '@angular/platform-browser';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { chooseValue, selectIn } from '../../../../testing/select';
import { provideTestTranslate } from '../../../../testing/translate';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { NotificationsService } from '../../../core/services/notifications.service';
import {
  NOTIFY_EVENT_KINDS,
  NotifyRule,
  NotifyRules,
  NotifyRulesService,
} from '../../../core/services/notify-rules.service';
import { RuleListComponent } from '../../../shared/monitor/rule-list/rule-list.component';
import { MultiSelectComponent } from '../../../shared/ui/multi-select/multi-select.component';
import { NotificationsSectionComponent } from './notifications-section.component';

/** Um critério guardado: silencia os avisos de likes de quem tem poucos likes. */
const CRITERIO: NotifyRule = {
  id: 'c1',
  field: 'likes',
  operator: 'lte',
  value: '2',
  mode: 'mute',
  kinds: ['likes'],
  enabled: true,
};

const PADRAO: NotifyRules = {
  decider: 'general',
  kinds: { opened: true, likes: true, pipeline: true, threads: true, left: true, review: true },
  onlyMine: false,
  minLikes: 0,
  ignoreDrafts: false,
  mutedAuthors: [],
  quietHours: null,
  cooldownMinutes: 0,
  rules: [],
};

describe('NotificationsSectionComponent', () => {
  let fixture: ComponentFixture<NotificationsSectionComponent>;
  let update: MockInstance<NotifyRulesService['update']>;
  let store = new FakePreferencesStore();
  const host = (): HTMLElement => fixture.nativeElement;
  // Com as regras guardadas, a seção parte delas: é o que a página recebia por input.
  const render = (rules: NotifyRules = PADRAO): void => {
    store.data['notifyRules'] = rules;
    fixture = TestBed.createComponent(NotificationsSectionComponent);
    update = vi.spyOn(TestBed.inject(NotifyRulesService), 'update');
    fixture.detectChanges();
  };
  const emitted = (): Partial<NotifyRules>[] => update.mock.calls.map((c) => c[0]);
  const campo = (rotulo: string): HTMLInputElement =>
    [...host().querySelectorAll<HTMLLabelElement>('label')].find((l) =>
      l.textContent?.includes(rotulo),
    )!.control as HTMLInputElement;
  // O painel do multi-select só existe aberto; é nele que estão as caixas.
  const abrirTipos = (): HTMLInputElement[] => {
    host()
      .querySelector<HTMLButtonElement>('[data-test="notify-kinds"] .ui-multi-select__trigger')!
      .click();
    fixture.detectChanges();
    return [
      ...host().querySelectorAll<HTMLInputElement>(
        '[data-test="notify-kinds"] .ui-multi-select__panel input[type="checkbox"]',
      ),
    ];
  };
  const rotulosDosTipos = (): string[] =>
    [
      ...host().querySelectorAll<HTMLElement>(
        '[data-test="notify-kinds"] .ui-multi-select__panel .ui-checkbox__label',
      ),
    ].map((el) => el.textContent!.trim());
  const digitar = (el: HTMLInputElement, valor: string): void => {
    el.value = valor;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    store = new FakePreferencesStore();
    await TestBed.configureTestingModule({
      imports: [NotificationsSectionComponent],
      providers: [
        provideTestTranslate(),
        provideHttpClient(),
        provideHttpClientTesting(),
        providePreferences(store),
      ],
    }).compileComponents();
  });

  it('é a seção "notificacoes", sem botão Salvar', () => {
    render();

    expect(host().querySelector('section#notificacoes')).not.toBeNull();
    expect(host().querySelector('button[type="submit"]')).toBeNull();
  });

  it('desenha "Avise quando acontecer" como um multi-select com os seis tipos', () => {
    render();

    expect(NOTIFY_EVENT_KINDS.length).toBe(6);
    const tipos = abrirTipos();
    expect(tipos.length).toBe(6);
    expect(rotulosDosTipos()).toEqual([
      'MR novo',
      'Likes',
      'Pipeline',
      'Threads',
      'MR que saiu da lista',
      'Revisão pedida a mim',
    ]);
    // Tudo ligado é o padrão: o corte geral não cala nada antes de ser mexido.
    expect(tipos.every((tipo) => tipo.checked)).toBe(true);
  });

  it('desmarcar um tipo no multi-select emite todos os tipos, com só aquele desligado', () => {
    render();

    abrirTipos()[1].click();
    fixture.detectChanges();

    expect(emitted()[0].kinds).toEqual({ ...PADRAO.kinds, likes: false });
  });

  it('remarcar o tipo o devolve ao corte geral', () => {
    render({ ...PADRAO, kinds: { ...PADRAO.kinds, likes: false } });

    const tipos = abrirTipos();
    expect(tipos[1].checked).toBe(false);
    tipos[1].click();
    fixture.detectChanges();

    expect(emitted().at(-1)!.kinds).toEqual(PADRAO.kinds);
  });

  it('autores silenciados viram uma lista, sem vazios nem espaços', () => {
    render();

    digitar(campo('Autores silenciados'), ' bot.ci, , ana.lima ');

    expect(emitted().at(-1)).toEqual({ mutedAuthors: ['bot.ci', 'ana.lima'] });
  });

  it('o mínimo de likes que não é número vale como zero', () => {
    render();

    digitar(campo('Mínimo de likes'), 'abc');

    expect(emitted().at(-1)).toEqual({ minLikes: 0 });
  });

  it('o horário silencioso só mostra os horários quando ligado, e liga com um padrão noturno', () => {
    render();
    expect(host().querySelector('input[type="time"]')).toBeNull();

    campo('Horário silencioso').click();

    expect(emitted().at(-1)).toEqual({ quietHours: { start: '19:00', end: '09:00' } });
  });

  it('com o horário ligado, mudar o fim emite a janela nova', () => {
    render({ ...PADRAO, quietHours: { start: '19:00', end: '09:00' } });

    digitar(campo('Até'), '07:30');

    expect(emitted().at(-1)).toEqual({ quietHours: { start: '19:00', end: '07:30' } });
  });

  it('avisa em uma linha que o evento calado é descartado', () => {
    render();

    expect(host().textContent).toContain('não é guardado para depois');
  });

  it('desenha a lista de critérios no editor compartilhado, sem Cor nem Traço', () => {
    render({ ...PADRAO, rules: [CRITERIO] });

    const lista = fixture.debugElement.query(By.directive(RuleListComponent))
      .componentInstance as RuleListComponent;
    expect(lista.appearance()).toBe(false);
    expect(lista.showMode()).toBe(true);
    expect(lista.showKinds()).toBe(true);
    expect(host().querySelector('[data-test="rule-tone"]')).toBeNull();
    expect(host().querySelector('[data-test="rule-mark"]')).toBeNull();
  });

  it('cada critério traz o modo e o multi-select de tipos, vazio quando vale para todos', () => {
    render({ ...PADRAO, rules: [CRITERIO] });

    expect(selectIn(fixture, 'rule-mode').value()).toBe('mute');
    expect(
      selectIn(fixture, 'rule-mode')
        .options()
        .map((o) => o.label),
    ).toEqual(['Notificar', 'Silenciar']);
    const tipos = fixture.debugElement.query(By.css('[data-test="rule-kinds"]'))
      .componentInstance as MultiSelectComponent;
    expect(tipos.value()).toEqual(['likes']);
    expect(tipos.options().map((o) => o.label)).toContain('Revisão pedida a mim');
  });

  it('adicionar, alterar e remover um critério vão para o NotifyRulesService', async () => {
    render({ ...PADRAO, rules: [CRITERIO] });
    const service = TestBed.inject(NotifyRulesService);
    const add = vi.spyOn(service, 'addRule');
    const update = vi.spyOn(service, 'updateRule');
    const remove = vi.spyOn(service, 'removeRule');

    await chooseValue(fixture, selectIn(fixture, 'rule-mode'), 'notify');
    host().querySelector<HTMLButtonElement>('[data-test="rule-add"]')!.click();
    host().querySelector<HTMLButtonElement>('[data-test="rule-remove"]')!.click();

    expect(update.mock.calls).toEqual([['c1', { mode: 'notify' }]]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('c1');
  });

  it('diz que o critério novo entra desligado, e o que aconteceria se não entrasse', () => {
    render();

    const texto = host().textContent!;
    expect(texto).toContain('Um critério novo entra desligado');
    expect(texto).toContain('calaria todos os avisos');
  });

  it('diz que o aviso sem os fatos do MR não é alcançado por critério nenhum', () => {
    render();

    const texto = host().textContent!;
    expect(texto).toContain('MR que saiu da lista');
    expect(texto).toContain('não é alcançado por critério nenhum');
  });

  it('explica que a escolha geral vale para tudo e o critério só para a sua regra', () => {
    render();

    const texto = host().textContent!;
    expect(texto).toContain('Vale para todos os avisos do Geral');
    expect(texto).toContain('vale só para aquela regra');
  });

  it('o interruptor e os botões de teste e verificação moram aqui', () => {
    render();
    const teste = vi
      .spyOn(TestBed.inject(NotificationsService), 'sendTest')
      .mockResolvedValue(undefined);
    const verificar = vi
      .spyOn(TestBed.inject(GitlabMonitorService), 'refreshNow')
      .mockResolvedValue();

    const botoes = [...host().querySelectorAll('button')];
    botoes.find((b) => b.textContent?.includes('Testar notificação'))!.click();
    botoes.find((b) => b.textContent?.includes('Verificar agora'))!.click();

    expect(campo('Avisar no navegador')).not.toBeNull();
    expect(teste).toHaveBeenCalledTimes(1);
    expect(verificar).toHaveBeenCalledTimes(1);
  });
});
