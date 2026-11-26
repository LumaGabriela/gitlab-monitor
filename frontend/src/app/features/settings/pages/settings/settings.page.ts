import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { filter, skip } from 'rxjs';
import { MonitorBootstrapService } from '../../../../core/services/monitor-bootstrap.service';
import { PageHeaderComponent } from '../../../../shared/layout/page-header/page-header.component';
import { PageToolsComponent } from '../../../../shared/layout/page-tools/page-tools.component';

/**
 * Casca das configurações: cabeçalho (com as ferramentas) e a saída da rota; a navegação mora no sidebar da casca. Cada
 * seção é uma rota filha que resolve o próprio estado; aqui só mora o que
 * vale para todas elas, e o `bootstrap.start()` fica aqui, e não nas filhas,
 * para que trocar de seção não reinicie o monitor.
 */
@Component({
  selector: 'app-settings-page',
  imports: [PageHeaderComponent, PageToolsComponent, RouterOutlet, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ui-page' },
  template: `
    <app-page-header [title]="'settings.title' | translate">
      <app-page-tools actions />
    </app-page-header>

    <div class="ui-settings-page__content">
      <router-outlet />
    </div>
  `,
})
export class SettingsPage implements OnInit {
  private readonly bootstrap = inject(MonitorBootstrapService);
  private readonly router = inject(Router);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);

  public constructor() {
    // A navegação que cria a casca só move o foco quando veio de dentro do app (por exemplo, do
    // Painel pelo sidebar); na carga ou recarga da página (sem navegação anterior) o foco fica
    // onde o navegador o pôs, para não voltar ao topo do documento.
    const veioDoApp = this.router.getCurrentNavigation()?.previousNavigation != null;
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        skip(veioDoApp ? 0 : 1),
        takeUntilDestroyed(),
      )
      .subscribe((): void => this.focusHeading());
  }

  public ngOnInit(): void {
    this.bootstrap.start();
  }

  /**
   * O foco vai para o título (h2) da seção que abriu, não para o h1: o h1 é
   * o nome da página e não muda entre seções; o h2 é o que diz onde a pessoa
   * chegou, e o leitor de tela o anuncia ao receber o foco. O alvo é o que
   * leva `data-focus-target`, e não o primeiro título do DOM.
   */
  private focusHeading(): void {
    afterNextRender(
      (): void =>
        this.host.nativeElement.querySelector<HTMLElement>('[data-focus-target]')?.focus(),
      { injector: this.injector },
    );
  }
}
