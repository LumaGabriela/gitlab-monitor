import { RuleOption } from '../../core/services/rule-editor.service';
import { SelectOption } from '../ui/select/select.model';

/**
 * `core/` não importa do Design System (§3), então declara a sua própria
 * opção. Esta é a trava, e quem reprova é o `tsc`: a função abaixo só compila
 * enquanto TODA `RuleOption` couber num `SelectOption`. Mudar a forma de um
 * sem o outro quebra aqui, na compilação, e não na tela.
 */
const ruleOptionFitsSelect = (option: RuleOption): SelectOption => option;

describe('contrato das opções de regra', () => {
  it('a opção que o core monta cabe no select do Design System', () => {
    expect(ruleOptionFitsSelect({ value: 'likes', label: 'Likes' })).toEqual({
      value: 'likes',
      label: 'Likes',
    });
  });
});
