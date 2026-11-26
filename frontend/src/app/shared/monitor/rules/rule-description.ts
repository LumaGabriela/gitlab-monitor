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
 * O nome da regra nos termos que a pessoa reconhece: o da sugestão de que ela nasceu, ou, se foi
 * feita à mão, campo, operador e valor traduzidos. Sem prefixo: é assim que a legenda o mostra,
 * onde o contexto já diz que se trata de destaque. Quem chama depende de `onLangChange`:
 * `instant()` não reage sozinho à troca de idioma nem à chegada do catálogo.
 */
export function describeRuleBody(translate: TranslateService, rule: HighlightRule): string {
  const key = suggestionKey(rule);
  const name = key
    ? translate.instant(`settings.suggestion-${key}`)
    : translate.instant('monitor.highlight-condition', {
        field: translate.instant(`settings.rule-field-${rule.field}`),
        operator: translate.instant(`settings.rule-op-${rule.operator}`),
        value: rule.value,
      });
  return name;
}

/**
 * Descreve todas as regras de uma vez para o leitor de tela, com o prefixo dito uma só vez
 * (`monitor.highlight-reasons`) e as descrições unidas por "; ". Aqui o prefixo fica: solto
 * na célula, o nome da regra não diria por que está sendo lido.
 */
export function describeRules(
  translate: TranslateService,
  rules: readonly HighlightRule[],
): string {
  return translate.instant('monitor.highlight-reasons', {
    rules: rules.map((rule) => describeRuleBody(translate, rule)).join('; '),
  });
}
