import { TranslateService } from '@ngx-translate/core';
import { ROW_RULE_SUGGESTIONS } from '../../../core/services/row-rules.service';
import { HighlightRule } from '../../../core/rules/rule-engine';

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A chave da sugestão de que esta regra ainda é cópia fiel (campo, operador e valor), ou nulo. */
function suggestionKey(rule: HighlightRule): string | null {
  const found = ROW_RULE_SUGGESTIONS.find(
    ({ rule: base }) =>
      base.field === rule.field && base.operator === rule.operator && same(base.value, rule.value),
  );
  return found?.key ?? null;
}

/**
 * Diz, nos termos que a pessoa reconhece, por que a regra destacou a linha: pelo nome da
 * sugestão de que ela nasceu, ou, se foi feita à mão, por campo, operador e valor traduzidos.
 * Os dois caminhos passam pela mesma chave (`monitor.highlight-reason`), para a frase
 * continuar traduzível inteira. Quem chama depende de `onLangChange`: `instant()` não reage
 * sozinho à troca de idioma nem à chegada do catálogo.
 */
export function describeRule(translate: TranslateService, rule: HighlightRule): string {
  const key = suggestionKey(rule);
  const name = key
    ? translate.instant(`settings.suggestion-${key}`)
    : translate.instant('monitor.highlight-condition', {
        field: translate.instant(`settings.rule-field-${rule.field}`),
        operator: translate.instant(`settings.rule-op-${rule.operator}`),
        value: rule.value,
      });
  return translate.instant('monitor.highlight-reason', { rule: name });
}
