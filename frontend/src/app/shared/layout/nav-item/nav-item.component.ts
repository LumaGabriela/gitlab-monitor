import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';

import { IconComponent, IconName } from '../../ui/icon/icon.component';
import { TooltipDirective } from '../../ui/tooltip/tooltip.directive';

// Adaptação: `exact` é acréscimo do gitlab-monitor.
/**
 * Item da navegação lateral (guia navigation do DS): default, hover, active, focus-visible, disabled.
 * É um link real; marca `aria-current="page"` quando a rota está ativa ou quando `active` é verdadeiro. Compacto (menu
 * em trilho): só o ícone à vista; o rótulo continua como nome acessível e aparece como dica no hover e no foco.
 */
@Component({
  selector: 'app-nav-item',
  imports: [RouterLink, RouterLinkActive, IconComponent, TooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (disabled()) {
      <a
        class="ui-nav-item ui-nav-item--disabled"
        [class.ui-nav-item--compact]="compact()"
        role="link"
        aria-disabled="true"
        tabindex="-1"
      >
        <app-icon [name]="icon()" />
        <span class="ui-nav-item__label" [class.ui-visually-hidden]="compact()">{{ label() }}</span>
      </a>
    } @else if (active()) {
      <a
        class="ui-nav-item ui-nav-item--active"
        [class.ui-nav-item--compact]="compact()"
        [appTooltip]="tip()"
        aria-current="page"
        [routerLink]="link()"
        [queryParams]="queryParams()"
        (click)="selected.emit()"
      >
        <app-icon [name]="icon()" />
        <span class="ui-nav-item__label" [class.ui-visually-hidden]="compact()">{{ label() }}</span>
      </a>
    } @else {
      <a
        class="ui-nav-item"
        [class.ui-nav-item--compact]="compact()"
        [appTooltip]="tip()"
        [routerLink]="link()"
        [queryParams]="queryParams()"
        routerLinkActive="ui-nav-item--active"
        ariaCurrentWhenActive="page"
        [routerLinkActiveOptions]="activeOptions()"
        (click)="selected.emit()"
      >
        <app-icon [name]="icon()" />
        <span class="ui-nav-item__label" [class.ui-visually-hidden]="compact()">{{ label() }}</span>
      </a>
    }
  `,
})
export class NavItemComponent {
  public readonly label: InputSignal<string> = input.required<string>();
  public readonly icon: InputSignal<IconName> = input.required<IconName>();
  public readonly link: InputSignal<string> = input.required<string>();
  /** Query params do link (filtros que valem entre telas). */
  public readonly queryParams: InputSignal<Readonly<Record<string, string>> | null> =
    input<Readonly<Record<string, string>> | null>(null);
  /** Só fica ativo na própria rota, não nas sub-rotas. */
  public readonly exact: InputSignal<boolean> = input<boolean>(false);
  public readonly active: InputSignal<boolean> = input<boolean>(false);
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);
  /** Menu em trilho: só o ícone; o rótulo vira dica. */
  public readonly compact: InputSignal<boolean> = input<boolean>(false);
  public readonly selected: OutputEmitterRef<void> = output<void>();

  /** Dica só no modo compacto (sem texto, a diretiva não abre nada). */
  protected readonly tip: Signal<string> = computed((): string =>
    this.compact() ? this.label() : '',
  );

  /**
   * A raiz só fica ativa na própria raiz; as demais também nas sub-rotas (ex.: /cards/ANT-1). Filtros na URL (query
   * params) não mudam qual item está ativo.
   */
  protected readonly activeOptions: Signal<IsActiveMatchOptions> = computed(
    (): IsActiveMatchOptions => ({
      // Adaptação: `exact()` é acréscimo do gitlab-monitor.
      paths: this.exact() || this.link() === '/' ? 'exact' : 'subset',
      queryParams: 'ignored',
      matrixParams: 'ignored',
      fragment: 'ignored',
    }),
  );
}
