import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InputSignal,
  ModelSignal,
  OutputEmitterRef,
  Signal,
  effect,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { nextControlId } from '../field/field-context';
import { IconButtonDirective } from '../icon-button/icon-button.directive';
import { IconComponent } from '../icon/icon.component';
import { FocusTrap } from '../overlay/focus-trap';

export type ModalSize = 'sm' | 'md';

/**
 * Modal: cabeçalho com fechar, corpo projetado e rodapé (`[modal-footer]`).
 * Foco preso, Esc e fundo fecham, e o foco volta a quem abriu. Fechado, o
 * conteúdo sai do DOM. Abaixo de `sm` ocupa a tela inteira.
 */
@Component({
  selector: 'app-modal',
  imports: [IconComponent, IconButtonDirective, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="ui-modal">
        <div class="ui-modal__backdrop" aria-hidden="true" (click)="close()"></div>
        <div
          #panel
          class="ui-modal__panel"
          [class.ui-modal__panel--sm]="size() === 'sm'"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          [attr.aria-labelledby]="titleId"
          (keydown.escape)="close()"
          (keydown.tab)="trap($event)"
        >
          <header class="ui-modal__header">
            <h2 class="ui-modal__title" [id]="titleId">{{ title() }}</h2>
            <button
              type="button"
              class="ui-modal__close"
              appIconButton
              [label]="'common.close' | translate"
              (click)="close()"
            >
              <app-icon name="close" />
            </button>
          </header>
          <div class="ui-modal__body"><ng-content /></div>
          <footer class="ui-modal__footer"><ng-content select="[modal-footer]" /></footer>
        </div>
      </div>
    }
  `,
})
export class ModalComponent {
  public readonly open: ModelSignal<boolean> = model<boolean>(false);
  public readonly title: InputSignal<string> = input.required<string>();
  public readonly size: InputSignal<ModalSize> = input<ModalSize>('md');
  public readonly closed: OutputEmitterRef<void> = output<void>();

  protected readonly titleId: string = nextControlId('modal-titulo');
  private readonly panel: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('panel');
  private readonly focusTrap: FocusTrap = new FocusTrap();

  public constructor() {
    // Abre: prende o foco. Fecha por qualquer caminho (Esc, fundo, ou o pai
    // pondo open=false): solta e devolve.
    effect((): void => {
      const panel = this.panel()?.nativeElement;
      if (panel) this.focusTrap.activate(panel);
      else if (this.focusTrap.active) this.finish();
    });
    inject(DestroyRef).onDestroy((): void => this.focusTrap.release());
  }

  public close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.finish();
  }

  private finish(): void {
    if (!this.focusTrap.active) return;
    this.focusTrap.release();
    this.closed.emit();
  }

  protected trap(event: Event): void {
    const panel = this.panel()?.nativeElement;
    if (panel && event instanceof KeyboardEvent) this.focusTrap.handleTab(panel, event);
  }
}
