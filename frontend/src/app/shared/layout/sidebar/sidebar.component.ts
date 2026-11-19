import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

import { NavItem, NavSection } from '../../models/navigation.model';
import { IconButtonDirective } from '../../ui/icon-button/icon-button.directive';
import { IconComponent } from '../../ui/icon/icon.component';
import { NavItemComponent } from '../nav-item/nav-item.component';

// Adaptação: chaves `shell.*` aninhadas e `exact` repassado ao item (acréscimo do gitlab-monitor).
/**
 * Barra lateral da casca: marca, botão do menu, navegação principal por seções e navegação de rodapé. Em trilho
 * (`collapsed`), mostra o botão, a marca logo abaixo dele e os ícones; o botão usa panel-left-close com o menu aberto e panel-left-open em
 * trilho. Sem `toggleLabel`, não há botão.
 */
@Component({
  selector: 'app-sidebar',
  imports: [NgTemplateOutlet, TranslatePipe, NavItemComponent, IconComponent, IconButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-sidebar" [class.ui-sidebar--rail]="collapsed()">
      <div class="ui-sidebar__brand">
        @if (collapsed()) {
          <!-- Trilho: o botão de abrir em cima e, logo abaixo, a marca (sem o texto, ela leva o nome). -->
          <ng-container [ngTemplateOutlet]="toggleButton" />
          <span class="ui-sidebar__mark" role="img" [attr.aria-label]="brandName()"
            ><app-icon name="chart"
          /></span>
        } @else {
          <!-- Marca, nome e botão numa linha; o subtítulo vai abaixo dos três. -->
          <span class="ui-sidebar__brand-row">
            <span class="ui-sidebar__mark" aria-hidden="true"><app-icon name="chart" /></span>
            <span class="ui-sidebar__brand-name">{{ brandName() }}</span>
            <ng-container [ngTemplateOutlet]="toggleButton" />
          </span>
          @if (brandTagline()) {
            <span class="ui-sidebar__brand-tagline">{{ brandTagline() }}</span>
          }
        }
      </div>

      <ng-template #toggleButton>
        @if (toggleLabel(); as rotulo) {
          <button
            type="button"
            class="ui-sidebar__toggle"
            appIconButton
            size="sm"
            [label]="rotulo"
            [attr.aria-expanded]="collapsed() ? 'false' : 'true'"
            (click)="toggled.emit()"
          >
            <app-icon [name]="collapsed() ? 'panel-left-open' : 'panel-left-close'" />
          </button>
        }
      </ng-template>

      <nav class="ui-sidebar__nav" [attr.aria-label]="'shell.main-navigation' | translate">
        @for (section of sections(); track $index) {
          <div class="ui-sidebar__section">
            @if (section.titleKey && !collapsed()) {
              <p class="ui-sidebar__section-title">{{ section.titleKey | translate }}</p>
            }
            <ul class="ui-sidebar__list">
              @for (item of section.items; track item.id) {
                <li>
                  <app-nav-item
                    [label]="item.labelKey | translate"
                    [icon]="item.icon"
                    [link]="item.link"
                    [queryParams]="item.queryParams ?? null"
                    [disabled]="item.disabled ?? false"
                    [exact]="item.exact ?? false"
                    [compact]="collapsed()"
                    (selected)="navigate.emit(item.id)"
                  />
                </li>
              }
            </ul>
          </div>
        }
      </nav>

      @if (footerItems().length || footerNote()) {
        <div class="ui-sidebar__footer">
          @if (footerItems().length) {
            <nav [attr.aria-label]="'shell.secondary-navigation' | translate">
              <ul class="ui-sidebar__list">
                @for (item of footerItems(); track item.id) {
                  <li>
                    <app-nav-item
                      [label]="item.labelKey | translate"
                      [icon]="item.icon"
                      [link]="item.link"
                      [queryParams]="item.queryParams ?? null"
                      [disabled]="item.disabled ?? false"
                      [exact]="item.exact ?? false"
                      [compact]="collapsed()"
                      (selected)="navigate.emit(item.id)"
                    />
                  </li>
                }
              </ul>
            </nav>
          }
          @if (footerNote() && !collapsed()) {
            <p class="ui-sidebar__note">{{ footerNote() }}</p>
          }
        </div>
      }
    </div>
  `,
})
export class SidebarComponent {
  public readonly brandName: InputSignal<string> = input.required<string>();
  public readonly brandTagline: InputSignal<string | null> = input<string | null>(null);
  public readonly sections: InputSignal<readonly NavSection[]> = input<readonly NavSection[]>([]);
  public readonly footerItems: InputSignal<readonly NavItem[]> = input<readonly NavItem[]>([]);
  public readonly footerNote: InputSignal<string | null> = input<string | null>(null);
  /** Menu em trilho: só o botão e os ícones. */
  public readonly collapsed: InputSignal<boolean> = input<boolean>(false);
  /** Nome acessível do botão do menu (recolher, expandir ou fechar a gaveta). Nulo = sem botão. */
  public readonly toggleLabel: InputSignal<string | null> = input<string | null>(null);
  public readonly navigate: OutputEmitterRef<string> = output<string>();
  public readonly toggled: OutputEmitterRef<void> = output<void>();
}
