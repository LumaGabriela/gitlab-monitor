import { IconName } from '../../shared/ui/icon/icon-registry';

/** Uma seção das configurações: o caminho da rota filha e as chaves de texto dela. */
export interface SettingsSection {
  readonly path: string;
  readonly labelKey: string;
  readonly summaryKey: string;
  readonly icon: IconName;
}

/** As seções na ordem da navegação e da visão geral. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    path: 'query',
    icon: 'query',
    labelKey: 'settings.query',
    summaryKey: 'settings.query-summary',
  },
  {
    path: 'notifications',
    icon: 'notifications',
    labelKey: 'settings.notifications',
    summaryKey: 'settings.notifications-summary',
  },
  {
    path: 'display',
    icon: 'display',
    labelKey: 'settings.display',
    summaryKey: 'settings.display-summary',
  },
  {
    path: 'columns',
    icon: 'columns',
    labelKey: 'settings.columns',
    summaryKey: 'settings.columns-summary',
  },
  {
    path: 'highlights',
    icon: 'highlights',
    labelKey: 'settings.highlights',
    summaryKey: 'settings.highlights-summary',
  },
  {
    path: 'presets',
    icon: 'presets',
    labelKey: 'settings.presets',
    summaryKey: 'settings.presets-summary',
  },
  { path: 'data', icon: 'data', labelKey: 'settings.data', summaryKey: 'settings.data-summary' },
];
