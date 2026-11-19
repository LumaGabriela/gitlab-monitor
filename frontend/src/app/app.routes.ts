import { Routes } from '@angular/router';
import { MonitorPage } from './features/monitor/pages/monitor/monitor.page';

/**
 * Rotas da aplicação. O servidor devolve o index.html para qualquer caminho
 * sem extensão, então recarregar `/settings/columns` cai aqui e não em 404.
 * Cada seção das configurações é uma rota filha da casca `SettingsPage`; a
 * raiz `/settings` não tem tela própria e redireciona para a primeira seção,
 * e um caminho de seção que não existe volta ao painel, como qualquer outro.
 *
 * **O painel é eager e `/settings` é lazy** (ADR 0004): o painel é a tela de
 * entrada, e adiar o que vai ser usado em seguida só atrasaria o primeiro
 * pixel; as configurações, que a maioria das sessões nunca abre, trazem junto
 * o editor de regras de destaque e o leitor de arquivo da importação.
 *
 * Nenhum `loadComponent` daqui pode passar a importar por um `index.ts`: o
 * bundler trata o barrel como um módulo só, e a tela voltaria para o bundle
 * inicial sem ninguém perceber. Este projeto não tem barrel nenhum (§3), e
 * este é um dos motivos.
 */
export const APP_ROUTES: Routes = [
  { path: '', component: MonitorPage },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/pages/settings/settings.page').then((m) => m.SettingsPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'query' },
      {
        path: 'query',
        loadComponent: () =>
          import('./features/settings/sections/query-section.component').then(
            (m) => m.QuerySectionComponent,
          ),
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/settings/sections/notifications-section.component').then(
            (m) => m.NotificationsSectionComponent,
          ),
      },
      {
        path: 'display',
        loadComponent: () =>
          import('./features/settings/sections/display-section.component').then(
            (m) => m.DisplaySectionComponent,
          ),
      },
      {
        path: 'columns',
        loadComponent: () =>
          import('./features/settings/sections/columns-section.component').then(
            (m) => m.ColumnsSectionComponent,
          ),
      },
      {
        path: 'highlights',
        loadComponent: () =>
          import('./features/settings/sections/highlights-section.component').then(
            (m) => m.HighlightsSectionComponent,
          ),
      },
      {
        path: 'presets',
        loadComponent: () =>
          import('./features/settings/sections/presets-section.component').then(
            (m) => m.PresetsSectionComponent,
          ),
      },
      {
        path: 'data',
        loadComponent: () =>
          import('./features/settings/sections/data-section.component').then(
            (m) => m.DataSectionComponent,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
