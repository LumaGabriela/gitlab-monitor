import { CellIconName, CellTone } from '../../core/models/api/panel-api.model';
import { BadgeTone } from '../ui/badge/badge.component';
import { IconName } from '../ui/icon/icon-registry';

/**
 * `core/` declara o vocabulário do backend sem depender do Design System
 * (§3), então nada impede que as duas listas sejam editadas em separado e
 * passem a discordar. Esta é a trava, e quem reprova é o `tsc`: as duas
 * funções abaixo só compilam enquanto TODO tom que o backend manda couber no
 * selo e TODO ícone couber no registro. Tirar um valor de `BadgeTone` sem
 * tirá-lo de `CellTone` quebra aqui, na compilação, e não na tela.
 */
const toneFitsBadge = (tone: CellTone): BadgeTone => tone;
const iconFitsRegistry = (icon: CellIconName): IconName => icon;

describe('contrato das células', () => {
  it('o tom e o ícone que o backend manda existem no Design System', () => {
    expect(toneFitsBadge('danger')).toBe('danger');
    expect(iconFitsRegistry('likes')).toBe('likes');
  });
});
