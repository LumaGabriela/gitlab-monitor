import { Injectable, effect, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ColumnOrderService } from './column-order.service';
import { ColumnVisibilityService } from './column-visibility.service';
import { DensityService } from './density.service';
import { GitlabMonitorService } from './gitlab-monitor.service';
import { NotificationsService } from './notifications.service';
import { NotifyRulesService } from './notify-rules.service';
import { TextSizeService } from './text-size.service';
import { ThemeService } from './theme.service';

/**
 * Preparo que toda página que depende de /data precisa: ligar a lista de
 * colunas, dar destino aos avisos de mudança, configurar as notificações e
 * iniciar o ciclo de consulta.
 *
 * Fica aqui, e não em cada página, porque recarregar `/settings` não
 * passa pelo painel: cada página que pode ser a primeira a abrir precisa do
 * mesmo preparo, e uma página nova só chama `start()`.
 */
@Injectable({ providedIn: 'root' })
export class MonitorBootstrapService {
  private readonly monitor = inject(GitlabMonitorService);
  private readonly columnVisibility = inject(ColumnVisibilityService);
  private readonly columnOrder = inject(ColumnOrderService);
  private readonly notifications = inject(NotificationsService);
  private readonly notifyRules = inject(NotifyRulesService);
  private readonly translate = inject(TranslateService);
  // Injetados só para existirem: o construtor de cada um aplica no <html> a
  // classe da preferência guardada. Um serviço root é criado na primeira
  // injeção, e quem abre o painel direto nunca passa pelas configurações.
  private readonly textSize = inject(TextSizeService);
  private readonly density = inject(DensityService);
  // O tema também: sem o botão do cabeçalho (as seções de /settings não o têm),
  // nada mais o construiria, e quem não passa pelo Python (ng serve) ficaria no automático.
  private readonly theme = inject(ThemeService);

  public constructor() {
    // Mantém a lista de colunas em dia assim que o backend informa quais
    // existem (REPORT_COLUMNS, via /data), sem duplicá-la no frontend.
    effect((): void => {
      const keys = this.monitor.columns().map((column) => column.key);
      this.columnVisibility.registerColumns(keys);
      this.columnOrder.registerColumns(keys);
    });
  }

  public start(): void {
    this.monitor.registerEventSink((events): boolean => {
      const wanted = this.notifyRules.filter(events);
      // Lote que as regras esvaziaram foi decidido, não perdido: conta como
      // entregue para o `since` avançar. Devolver false aqui faria o servidor
      // reenviar os mesmos eventos a cada consulta, para sempre.
      if (!wanted.length) return true;
      const delivered = this.notifications.announce(
        wanted,
        this.translate.instant('notifications.summary-title', { count: wanted.length }),
      );
      // A espera só começa com o aviso entregue: se não foi, o lote volta na
      // próxima consulta e não pode ser cortado por uma espera que nunca valeu.
      if (delivered) this.notifyRules.markNotified(wanted);
      return delivered;
    });
    this.notifications.setup();
    this.monitor.start();
  }
}
