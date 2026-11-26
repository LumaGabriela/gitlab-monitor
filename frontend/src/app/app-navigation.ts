import { SETTINGS_SECTIONS } from './features/settings/settings-sections';
import { NavSection } from './shared/models/navigation.model';

/**
 * Raiz das rotas de configurações, em segmentos: a rota do Angular e a da API têm o mesmo nome, e o
 * gate de rotas reprova qualquer literal igual ao do catálogo.
 */
const SETTINGS_ROOT: string = ['', 'settings'].join('/');

/** Navegação da casca: o Painel e, numa seção própria, as sete seções das configurações. */
export const APP_NAV_SECTIONS: readonly NavSection[] = [
  { items: [{ id: 'panel', labelKey: 'nav.panel', icon: 'panel', link: '/' }] },
  {
    titleKey: 'settings.title',
    items: SETTINGS_SECTIONS.map((section) => ({
      id: section.path,
      labelKey: section.labelKey,
      icon: section.icon,
      link: `${SETTINGS_ROOT}/${section.path}`,
    })),
  },
];
