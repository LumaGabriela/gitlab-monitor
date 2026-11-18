import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  Signal,
  computed,
  input,
} from '@angular/core';

export type SkeletonVariant = 'line' | 'block' | 'tile';

/** Esqueleto de carregamento, decorativo. Quem carrega marca `aria-busy` no
 * contêiner — o esqueleto em si sai da árvore de acessibilidade. */
@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'ui-skeleton-group' },
  template: `
    @for (i of items(); track i) {
      <span [class]="'ui-skeleton ui-skeleton--' + variant()"></span>
    }
  `,
})
export class SkeletonComponent {
  public readonly variant: InputSignal<SkeletonVariant> = input<SkeletonVariant>('line');
  public readonly lines: InputSignal<number> = input<number>(1);

  protected readonly items: Signal<number[]> = computed((): number[] =>
    Array.from({ length: Math.max(1, this.lines()) }, (_: unknown, i: number): number => i),
  );
}
