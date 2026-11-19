import { IconName } from '../ui/icon/icon-registry';

/** Item de navegação da casca. `labelKey` é chave de tradução (o componente traduz). */
export interface NavItem {
  readonly id: string;
  readonly labelKey: string;
  readonly icon: IconName;
  readonly link: string;
  /** Filtros que valem entre telas (ex.: projeto), levados no link. */
  readonly queryParams?: Readonly<Record<string, string>>;
  readonly disabled?: boolean;
  // Adaptação: `exact` é acréscimo do gitlab-monitor (o item /settings não fica ativo em /settings/columns).
  /** Só fica ativo na própria rota, não nas sub-rotas. */
  readonly exact?: boolean;
}

/** Grupo de itens da barra lateral, com título opcional (chave de tradução). */
export interface NavSection {
  readonly titleKey?: string;
  readonly items: readonly NavItem[];
}
