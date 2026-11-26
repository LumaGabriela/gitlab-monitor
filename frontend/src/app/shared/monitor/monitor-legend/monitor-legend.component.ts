import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  Signal,
  computed,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { IconComponent } from '../../ui/icon/icon.component';
import { describeRuleBody } from '../rules/rule-description';
import { HighlightRule, markStyleOf } from '../../../core/rules/rule-engine';

interface LegendRule {
  readonly id: string;
  readonly tone: string;
  readonly markStyle: string;
  readonly text: string;
}

/** Explica os sinais da tabela que não são texto: a marca de alteração e o destaque de cada
 * regra ligada, com a mesma cor e o mesmo traço que a linha destacada tem. O nome da regra vem
 * sem o "Destaque:" — aqui a legenda inteira já diz que se trata de destaque, e repetir o
 * prefixo em cada item só alongava a linha. O selo de likes não entra aqui: o limite dele é
 * preferência de quem olha (Configurações). */
@Component({
  selector: 'app-monitor-legend',
  imports: [IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ui-legend' },
  template: `
    <span class="ui-legend__item">
      <app-icon class="ui-changed-mark" name="changed" size="sm" />
      {{ 'monitor.legend-changed' | translate }}
    </span>
    @for (entry of entries(); track entry.id) {
      <span
        class="ui-legend__item ui-legend__rule"
        [class.ui-legend__rule--tone-danger]="entry.tone === 'danger'"
        [class.ui-legend__rule--tone-warning]="entry.tone === 'warning'"
        [class.ui-legend__rule--tone-success]="entry.tone === 'success'"
        [class.ui-legend__rule--tone-strong]="entry.tone === 'strong'"
        [class.ui-legend__rule--tone-info]="entry.tone === 'info'"
        [class.ui-legend__rule--tone-neutral]="entry.tone === 'neutral'"
        [class.ui-legend__rule--mark-solid]="entry.markStyle === 'solid'"
        [class.ui-legend__rule--mark-dashed]="entry.markStyle === 'dashed'"
        [class.ui-legend__rule--mark-dotted]="entry.markStyle === 'dotted'"
        [class.ui-legend__rule--mark-double]="entry.markStyle === 'double'"
      >
        {{ entry.text }}
      </span>
    }
  `,
})
export class MonitorLegendComponent {
  private readonly translate = inject(TranslateService);
  // `instant()` não reage à troca de idioma: sem esta dependência, o texto ficaria no idioma anterior.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  /** As regras de destaque; só as ligadas entram. */
  public readonly rules: InputSignal<readonly HighlightRule[]> = input<readonly HighlightRule[]>(
    [],
  );

  protected readonly entries: Signal<readonly LegendRule[]> = computed(
    (): readonly LegendRule[] => {
      this.language();
      return this.rules()
        .filter((rule) => rule.enabled)
        .map((rule) => ({
          id: rule.id,
          tone: rule.tone,
          markStyle: markStyleOf(rule),
          text: describeRuleBody(this.translate, rule),
        }));
    },
  );
}
