import { Injectable, Signal, WritableSignal, signal } from '@angular/core';
import { PanelEventModel } from '../models/api/panel-api.model';

/** Acima disto, um aviso só com o resumo: dez balões seguidos viram ruído. */
const MAX_NOTIFICATIONS = 5;

/**
 * Notificações do navegador para as mudanças de MR.
 *
 * `hint` guarda uma CHAVE de tradução, não um texto: quem mostra é a tela, e
 * é lá que o catálogo é consultado.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly on: WritableSignal<boolean> = signal<boolean>(true);
  private readonly hintKey: WritableSignal<string | null> = signal<string | null>(null);

  public readonly enabled: Signal<boolean> = this.on.asReadonly();
  public readonly hint: Signal<string | null> = this.hintKey.asReadonly();

  private supported(): boolean {
    return 'Notification' in window;
  }

  /**
   * Chamado uma vez, ao abrir a página: deixa as notificações prontas sem
   * exigir um clique quando a permissão já foi decidida antes.
   */
  public setup(): void {
    if (!this.supported()) {
      this.on.set(false);
      this.hintKey.set('notifications.unsupported');
      return;
    }
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') {
      this.on.set(false);
      this.hintKey.set('notifications.blocked');
      return;
    }

    // O navegador só aceita o pedido de permissão a partir de um gesto do
    // usuário; por isso ele fica pendurado no primeiro clique ou tecla.
    this.hintKey.set('notifications.awaiting-permission');
    let asked = false;
    const ask = (): void => {
      if (asked) return;
      asked = true;
      void this.requestPermission();
    };
    document.addEventListener('pointerdown', ask, { once: true });
    document.addEventListener('keydown', ask, { once: true });
  }

  public async onToggle(checked: boolean): Promise<void> {
    this.on.set(checked);
    if (!checked) {
      this.hintKey.set(null);
      return;
    }
    if (!this.supported()) {
      this.on.set(false);
      this.hintKey.set('notifications.unsupported');
      return;
    }
    await this.requestPermission();
  }

  public async sendTest(title: string, body: string): Promise<void> {
    if (!this.supported()) {
      this.hintKey.set('notifications.unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      this.hintKey.set('notifications.blocked');
      return;
    }
    if (Notification.permission !== 'granted' && !(await this.requestPermission())) return;
    new Notification(title, { body, tag: 'teste' });
    this.hintKey.set('notifications.test-sent');
  }

  /**
   * true quando os eventos foram mesmo entregues ao navegador — é o que
   * deixa GitlabMonitorService avançar o `since` sem perder aviso.
   */
  public announce(events: readonly PanelEventModel[], summaryTitle: string): boolean {
    if (!this.supported() || Notification.permission !== 'granted') return false;
    if (!this.on()) return true;
    if (events.length > MAX_NOTIFICATIONS) {
      new Notification(summaryTitle, {
        body: events.map((event) => event.text.split('\n')[0]).join('\n'),
        tag: 'resumo',
      });
      return true;
    }
    for (const { text } of events) {
      const lines = text.split('\n');
      new Notification(lines[0], { body: lines.slice(1).join('\n'), tag: text });
    }
    return true;
  }

  private async requestPermission(): Promise<boolean> {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      this.hintKey.set(null);
      return true;
    }
    this.on.set(false);
    this.hintKey.set('notifications.denied');
    return false;
  }
}
