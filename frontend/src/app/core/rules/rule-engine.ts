import { RowFactsModel } from '../models/api/panel-api.model';

/**
 * Motor das regras de destaque de linha: funções puras que comparam os fatos
 * crus de uma linha com o que a pessoa escolheu. Nenhuma regra de negócio do
 * GitLab mora aqui; só a comparação.
 */

export type RuleField = keyof RowFactsModel;
export type RuleOperator = 'gte' | 'lte' | 'eq' | 'neq';
export type RuleTone = 'danger' | 'warning' | 'success' | 'strong' | 'info' | 'neutral';
/** O traço da borda do marcador de linha, escolhido à parte da cor. */
export type RuleMarkStyle = 'solid' | 'dashed' | 'dotted' | 'double';
/** O que a regra faz ao casar: avisa ou silencia. */
export type RuleMode = 'notify' | 'mute';
export type RuleFieldKind = 'number' | 'boolean' | 'text';

export interface HighlightRule {
  readonly id: string;
  readonly field: RuleField;
  readonly operator: RuleOperator;
  /** Cru, como digitado. */
  readonly value: string;
  readonly tone: RuleTone;
  readonly markStyle: RuleMarkStyle;
  readonly enabled: boolean;
}

/** O tipo de cada fato decide como o valor digitado é lido. */
export const RULE_FIELD_KINDS: Readonly<Record<RuleField, RuleFieldKind>> = {
  likes: 'number',
  unresolved: 'number',
  participants: 'number',
  ageHours: 'number',
  idleHours: 'number',
  mergeable: 'boolean',
  conflicts: 'boolean',
  mine: 'boolean',
  involved: 'boolean',
  draft: 'boolean',
  pipeline: 'text',
  author: 'text',
  assignedToMe: 'boolean',
  reviewingMine: 'boolean',
  myReviewState: 'text',
  assignees: 'number',
  reviewers: 'number',
};

export const RULE_FIELDS: readonly RuleField[] = Object.keys(RULE_FIELD_KINDS) as RuleField[];
export const RULE_OPERATORS: readonly RuleOperator[] = ['gte', 'lte', 'eq', 'neq'];
export const RULE_TONES: readonly RuleTone[] = [
  'danger',
  'warning',
  'success',
  'strong',
  'info',
  'neutral',
];
export const RULE_MARK_STYLES: readonly RuleMarkStyle[] = ['solid', 'dashed', 'dotted', 'double'];
export const RULE_MODES: readonly RuleMode[] = ['notify', 'mute'];

/** O traço que cada tom já desenhava antes de cor e traço se separarem; os
 * tons novos começam em `solid`. */
export const DEFAULT_MARK_STYLE: Readonly<Record<RuleTone, RuleMarkStyle>> = {
  danger: 'solid',
  warning: 'dashed',
  success: 'double',
  strong: 'dotted',
  info: 'solid',
  neutral: 'solid',
};

/** O traço da regra: o guardado quando o código o conhece; senão, o padrão do
 * tom. Traço que o código não entende não pode descartar a regra. */
export function markStyleOf(rule: { tone: RuleTone; markStyle?: string }): RuleMarkStyle {
  const stored = rule.markStyle;
  return (RULE_MARK_STYLES as readonly (string | undefined)[]).includes(stored)
    ? (stored as RuleMarkStyle)
    : DEFAULT_MARK_STYLE[rule.tone];
}

/**
 * Os operadores que cada tipo aceita. "Maior ou igual" sobre um booleano ou
 * sobre o nome do autor nunca casa (`compareEquality` devolve `false`), então
 * oferecê-los seria oferecer uma regra morta: a tela só mostra o que compara.
 */
export const RULE_OPERATORS_BY_KIND: Readonly<Record<RuleFieldKind, readonly RuleOperator[]>> = {
  number: ['gte', 'lte', 'eq', 'neq'],
  boolean: ['eq', 'neq'],
  text: ['eq', 'neq'],
};

/** Os estados de revisão que o GitLab escreve hoje. O campo continua sendo
 * texto livre (o GitLab pode acrescentar outro), então são sugestões: o valor
 * guardado que não estiver aqui continua valendo. */
export const REVIEW_STATE_SUGGESTIONS: readonly string[] = [
  'unreviewed',
  'reviewed',
  'requested_changes',
  'approved',
];

export function operatorsFor(field: RuleField): readonly RuleOperator[] {
  return RULE_OPERATORS_BY_KIND[RULE_FIELD_KINDS[field]];
}

/** O operador que vale ao trocar de campo: o que estava escolhido, quando o
 * campo novo o aceita; senão, igualdade, que todo tipo aceita. */
export function keepOperator(field: RuleField, operator: RuleOperator): RuleOperator {
  return operatorsFor(field).includes(operator) ? operator : 'eq';
}

/** O valor que a regra passa a ter ao trocar de campo: o anterior comparava
 * outra coisa. Booleano começa em "sim", que é a pergunta que se quer fazer;
 * os demais começam vazios, e regra sem valor não casa com nada. */
export function defaultValueFor(field: RuleField): string {
  return RULE_FIELD_KINDS[field] === 'boolean' ? 'true' : '';
}

/** Número finito e não negativo; qualquer outra coisa é `null`, e regra sem
 * valor utilizável nunca casa (não pinta a tabela inteira). */
function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function parseBoolean(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  return value === 'true' ? true : value === 'false' ? false : null;
}

function compareNumber(operator: RuleOperator, fact: number, raw: string): boolean {
  const target = parseNumber(raw);
  if (target === null) return false;
  switch (operator) {
    case 'gte':
      return fact >= target;
    case 'lte':
      return fact <= target;
    case 'eq':
      return fact === target;
    case 'neq':
      return fact !== target;
  }
}

/** `neq` é a negação de `eq`; maior e menor não fazem sentido fora de número. */
function compareEquality(operator: RuleOperator, equal: boolean): boolean {
  if (operator === 'eq') return equal;
  if (operator === 'neq') return !equal;
  return false;
}

/** A comparação de uma regra, sem o que a decora (tom, traço, ligada): é só o
 * que `matches` lê, e a regra de aviso a satisfaz sem inventar cor. */
export interface RuleCriterion {
  readonly field: RuleField;
  readonly operator: RuleOperator;
  readonly value: string;
}

export function matches(rule: RuleCriterion, facts: RowFactsModel): boolean {
  const fact = facts[rule.field];
  switch (RULE_FIELD_KINDS[rule.field]) {
    case 'number':
      return compareNumber(rule.operator, fact as number, rule.value);
    case 'boolean': {
      const target = parseBoolean(rule.value);
      if (target === null) return false;
      // Fato desconhecido (null) não é verdadeiro nem falso: só `neq` o inclui.
      return compareEquality(rule.operator, fact === target);
    }
    case 'text': {
      const target = rule.value.trim().toLowerCase();
      if (target === '') return false;
      return compareEquality(rule.operator, String(fact).trim().toLowerCase() === target);
    }
  }
}

/** A primeira regra ligada que casa decide a linha: o tom e o texto do destaque saem dela. */
export function firstMatch(
  rules: readonly HighlightRule[],
  facts: RowFactsModel,
): HighlightRule | null {
  return rules.find((rule) => rule.enabled && matches(rule, facts)) ?? null;
}

export function firstTone(rules: readonly HighlightRule[], facts: RowFactsModel): RuleTone | null {
  return firstMatch(rules, facts)?.tone ?? null;
}
