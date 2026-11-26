import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { NavItem, NavSection } from '../../models/navigation.model';
import { IconComponent } from '../../ui/icon/icon.component';
import { DrawerComponent } from '../drawer/drawer.component';
import { SidebarComponent } from '../sidebar/sidebar.component';

// Adaptação: chaves `shell.*` aninhadas e trilho sem persistência (`signal(false)`, sem gravar no navegador).
/**
 * Casca da aplicação (F-00): barra lateral fixa a partir de `md`, com botão no topo que a reduz a trilho (só ícones) e
 * a expande de novo (a escolha não é guardada); abaixo de `md`, barra superior com o botão que abre a mesma navegação
 * numa gaveta (D5), onde o botão do topo a fecha. O conteúdo da página é projetado dentro de `<main id="conteudo">`.
 */
@Component({
  selector: 'app-shell',
  imports: [NgTemplateOutlet, TranslatePipe, IconComponent, DrawerComponent, SidebarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-shell" [class.ui-shell--rail]="rail()">
      <a class="ui-shell__skip" href="#conteudo" (click)="skipToContent($event)">{{
        'shell.skip-to-content' | translate
      }}</a>

      <header class="ui-shell__topbar">
        <button
          type="button"
          class="ui-shell__menu-button"
          aria-controls="app-shell-drawer"
          [attr.aria-label]="'shell.open-menu' | translate"
          [attr.aria-expanded]="drawerOpen()"
          (click)="drawerOpen.set(true)"
        >
          <app-icon name="panel-left-open" />
        </button>
        <span class="ui-shell__topbar-brand">{{ brandName() }}</span>
      </header>

      <aside class="ui-shell__sidebar">
        <ng-container
          [ngTemplateOutlet]="sidebar"
          [ngTemplateOutletContext]="{ $implicit: false }"
        />
      </aside>

      <main #main id="conteudo" class="ui-shell__main" tabindex="-1">
        <ng-content />
      </main>
    </div>

    <app-drawer
      id="app-shell-drawer"
      [(open)]="drawerOpen"
      [label]="'shell.main-navigation' | translate"
    >
      <ng-container [ngTemplateOutlet]="sidebar" [ngTemplateOutletContext]="{ $implicit: true }" />
    </app-drawer>

    <!-- Na gaveta, o botão do topo fecha a gaveta; na barra fixa, alterna entre aberta e trilho. -->
    <ng-template #sidebar let-naGaveta>
      <app-sidebar
        [brandName]="brandName()"
        [brandTagline]="brandTagline()"
        [sections]="sections()"
        [footerItems]="footerItems()"
        [footerNote]="footerNote()"
        [collapsed]="!naGaveta && rail()"
        [toggleLabel]="
          (naGaveta ? 'shell.close-menu' : rail() ? 'shell.expand-menu' : 'shell.collapse-menu')
            | translate
        "
        (toggled)="naGaveta ? drawerOpen.set(false) : toggleRail()"
        (navigate)="drawerOpen.set(false)"
      />
    </ng-template>
  `,
})
export class ShellComponent {
  public readonly brandName: InputSignal<string> = input.required<string>();
  public readonly brandTagline: InputSignal<string | null> = input<string | null>(null);
  public readonly sections: InputSignal<readonly NavSection[]> = input<readonly NavSection[]>([]);
  public readonly footerItems: InputSignal<readonly NavItem[]> = input<readonly NavItem[]>([]);
  public readonly footerNote: InputSignal<string | null> = input<string | null>(null);

  protected readonly drawerOpen: WritableSignal<boolean> = signal(false);
  /** Barra fixa reduzida a trilho; começa sempre expandida. */
  protected readonly rail: WritableSignal<boolean> = signal(false);
  private readonly main: Signal<ElementRef<HTMLElement>> =
    viewChild.required<ElementRef<HTMLElement>>('main');

  public constructor() {
    this.closeDrawerOnWideScreen();
  }

  /**
   * A gaveta só existe abaixo de `md`: ao alargar a janela com ela aberta, fecha (senão volta aberta ao estreitar).
   * O valor vem do token `--breakpoint-md`, para não repetir o número aqui.
   */
  private closeDrawerOnWideScreen(): void {
    const doc: Document = inject(DOCUMENT);
    const view = doc.defaultView;
    const md = view
      ?.getComputedStyle(doc.documentElement)
      .getPropertyValue('--breakpoint-md')
      .trim();
    if (!view?.matchMedia || !md) return;
    const consulta = view.matchMedia(`(min-width: ${md})`);
    const aoMudar = (e: { matches: boolean }): void => {
      if (e.matches) this.drawerOpen.set(false);
    };
    consulta.addEventListener('change', aoMudar);
    inject(DestroyRef).onDestroy((): void => consulta.removeEventListener('change', aoMudar));
  }

  protected toggleRail(): void {
    this.rail.set(!this.rail());
  }

  /** Foca o conteúdo sem navegar: com `<base href="/">`, o `#conteudo` levaria para a raiz. */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }
}
