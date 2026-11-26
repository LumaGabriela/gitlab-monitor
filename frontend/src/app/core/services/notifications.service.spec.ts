import { TestBed } from '@angular/core/testing';
import { PanelEventModel } from '../models/api/panel-api.model';
import { NotificationsService } from './notifications.service';

function event(text: string): PanelEventModel {
  return {
    kind: 'likes',
    text,
    mr: '1:1',
    title: 'MR 1',
    author: 'ana.lima',
    url: 'https://gitlab.example/1',
    likes: 2,
    mine: false,
    involved: false,
    draft: false,
  };
}

describe('NotificationsService.announce', () => {
  const created: { title: string; options: NotificationOptions }[] = [];

  beforeEach(() => {
    created.length = 0;
    class FakeNotification {
      public static readonly permission: NotificationPermission = 'granted';
      public constructor(title: string, options: NotificationOptions) {
        created.push({ title, options });
      }
    }
    vi.stubGlobal('Notification', FakeNotification);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('mostra o texto de três linhas do evento: a primeira é o título, o resto o corpo', () => {
    const delivered = TestBed.inject(NotificationsService).announce(
      [event('!1 — MR 1\nLIKES 1 → 2\nhttps://gitlab.example/1')],
      'resumo',
    );

    expect(delivered).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe('!1 — MR 1');
    expect(created[0].options.body).toBe('LIKES 1 → 2\nhttps://gitlab.example/1');
  });
});
