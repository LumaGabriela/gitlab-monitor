import type { MockInstance } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { NotificationsService } from '../../../core/services/notifications.service';
import {
  NOTIFY_EVENT_KINDS,
  NotifyRules,
  NotifyRulesService,
} from '../../../core/services/notify-rules.service';
import { NotificationsSectionComponent } from './notifications-section.component';

const PADRAO: NotifyRules = {
  kinds: { opened: true, likes: true, pipeline: true, threads: true, left: true, review: true },
  onlyMine: false,
  minLikes: 0,
  ignoreDrafts: false,
  mutedAuthors: [],
  quietHours: null,
  cooldownMinutes: 0,
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

  it('oferece um interruptor por tipo de evento', () => {
    render();

    expect(NOTIFY_EVENT_KINDS.length).toBe(6);
    expect(host().querySelectorAll('.ui-settings__kinds input[type="checkbox"]').length).toBe(6);
  });

  it('desligar um tipo emite todos os tipos, com só aquele desligado', () => {
    render();

    campo('Likes').click();

    expect(emitted()[0].kinds).toEqual({ ...PADRAO.kinds, likes: false });
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
