import {
  MAX_KEY_HOLD_DURATION_MS,
  MAX_SCRIPT_VARIABLE_COUNT,
  MAX_WAIT_MS,
  parseAutomationScript,
} from "../../shared/automation/schema";
import type {
  AutomationScriptStatement,
  AutomationScriptValue,
  ValidKeyIdentifier,
  ValidModifierKey,
} from "../../shared/automation/schema";

type ExpressionToken =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null"; value: null }
  | { kind: "identifier"; value: string }
  | {
      kind: "operator";
      value:
        | "+"
        | "-"
        | "*"
        | "/"
        | "=="
        | "!="
        | ">"
        | ">="
        | "<"
        | "<="
        | "&&"
        | "||"
        | "!";
    }
  | { kind: "paren"; value: "(" | ")" };

export interface AutomationScriptExecutionContext {
  script: string;
  label?: string;
  variables: Map<string, AutomationScriptValue>;
  readOnlyVariableNames?: ReadonlySet<string>;
  assertCanContinue?: () => void;
  log: (message: string) => Promise<void>;
  speak: (text: string) => Promise<void>;
  setMicState: (enabled: boolean) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  pressKey: (key: ValidKeyIdentifier, durationMs?: number) => Promise<void>;
  keyDown: (key: ValidKeyIdentifier) => Promise<void>;
  keyUp: (key: ValidKeyIdentifier) => Promise<void>;
  keyCombination: (
    modifiers: ValidModifierKey[],
    key: ValidKeyIdentifier,
  ) => Promise<void>;
  callCommand: (commandId: string) => Promise<void>;
  setBackground: (backgroundId: string) => Promise<void>;
  restoreBackground: () => Promise<void>;
}

const formatStatementLabel = (
  label: string,
  statement: AutomationScriptStatement,
): string => `${label} line ${statement.lineNumber}`;

const decodeExpressionEscape = (
  value: string,
  contextLabel: string,
): string => {
  switch (value) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "\\":
      return "\\";
    case '"':
      return '"';
    case "'":
      return "'";
    default:
      throw new Error(
        `${contextLabel} uses unsupported escape sequence "\\${value}".`,
      );
  }
};

const tokenizeExpression = (
  expression: string,
  contextLabel: string,
): ExpressionToken[] => {
  const tokens: ExpressionToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const character = expression[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    const twoCharacterOperator = expression.slice(index, index + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(twoCharacterOperator)) {
      tokens.push({
        kind: "operator",
        value: twoCharacterOperator as ExpressionToken["value"],
      });
      index += 2;
      continue;
    }

    if (["+", "-", "*", "/", ">", "<", "!"].includes(character)) {
      tokens.push({
        kind: "operator",
        value: character as ExpressionToken["value"],
      });
      index += 1;
      continue;
    }

    if (character === "(" || character === ")") {
      tokens.push({
        kind: "paren",
        value: character,
      });
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      const quote = character;
      let parsed = "";
      index += 1;

      while (index < expression.length) {
        const current = expression[index];
        if (current === "\\") {
          index += 1;
          if (index >= expression.length) {
            throw new Error(
              `${contextLabel} ends with an unfinished string escape.`,
            );
          }
          parsed += decodeExpressionEscape(expression[index], contextLabel);
          index += 1;
          continue;
        }
        if (current === quote) {
          index += 1;
          break;
        }
        parsed += current;
        index += 1;
      }

      if (index > expression.length || expression[index - 1] !== quote) {
        throw new Error(`${contextLabel} has an unterminated string literal.`);
      }

      tokens.push({ kind: "string", value: parsed });
      continue;
    }

    if (/\d/.test(character)) {
      let endIndex = index + 1;
      while (
        endIndex < expression.length &&
        /[\d.]/.test(expression[endIndex])
      ) {
        endIndex += 1;
      }
      const rawNumber = expression.slice(index, endIndex);
      const parsedNumber = Number(rawNumber);
      if (!Number.isFinite(parsedNumber)) {
        throw new Error(
          `${contextLabel} contains invalid number "${rawNumber}".`,
        );
      }
      tokens.push({ kind: "number", value: parsedNumber });
      index = endIndex;
      continue;
    }

    if (/[A-Za-z_]/.test(character)) {
      let endIndex = index + 1;
      while (
        endIndex < expression.length &&
        /[A-Za-z0-9_]/.test(expression[endIndex])
      ) {
        endIndex += 1;
      }
      const identifier = expression.slice(index, endIndex);
      if (identifier === "true" || identifier === "false") {
        tokens.push({ kind: "boolean", value: identifier === "true" });
      } else if (identifier === "null") {
        tokens.push({ kind: "null", value: null });
      } else {
        tokens.push({ kind: "identifier", value: identifier });
      }
      index = endIndex;
      continue;
    }

    throw new Error(
      `${contextLabel} contains unexpected character "${character}".`,
    );
  }

  return tokens;
};

type ExpressionParserState = {
  tokens: ExpressionToken[];
  index: number;
  variables: Map<string, AutomationScriptValue>;
  contextLabel: string;
};

const peekToken = (state: ExpressionParserState): ExpressionToken | null =>
  state.tokens[state.index] ?? null;

const consumeToken = (state: ExpressionParserState): ExpressionToken | null => {
  const token = peekToken(state);
  if (token) {
    state.index += 1;
  }
  return token;
};

const matchesOperator = (
  state: ExpressionParserState,
  operator: ExpressionToken["value"],
): boolean => {
  const token = peekToken(state);
  return token?.kind === "operator" && token.value === operator;
};

const matchesParen = (
  state: ExpressionParserState,
  paren: "(" | ")",
): boolean => {
  const token = peekToken(state);
  return token?.kind === "paren" && token.value === paren;
};

const coerceTruthiness = (value: AutomationScriptValue): boolean => {
  if (value === null) {
    return false;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return value.length > 0;
};

const stringifyScriptValue = (value: AutomationScriptValue): string => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
};

const coerceNumber = (
  value: AutomationScriptValue,
  contextLabel: string,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${contextLabel} expected a numeric value.`);
  }
  return value;
};

const compareValues = (
  left: AutomationScriptValue,
  right: AutomationScriptValue,
  operator: ">" | ">=" | "<" | "<=",
  contextLabel: string,
): boolean => {
  if (typeof left === "number" && typeof right === "number") {
    switch (operator) {
      case ">":
        return left > right;
      case ">=":
        return left >= right;
      case "<":
        return left < right;
      case "<=":
        return left <= right;
      default:
        return false;
    }
  }

  if (typeof left === "string" && typeof right === "string") {
    switch (operator) {
      case ">":
        return left > right;
      case ">=":
        return left >= right;
      case "<":
        return left < right;
      case "<=":
        return left <= right;
      default:
        return false;
    }
  }

  throw new Error(
    `${contextLabel} can compare only numbers or strings with "${operator}".`,
  );
};

const parsePrimary = (state: ExpressionParserState): AutomationScriptValue => {
  if (matchesParen(state, "(")) {
    consumeToken(state);
    const value = parseLogicalOr(state);
    if (!matchesParen(state, ")")) {
      throw new Error(
        `${state.contextLabel} is missing a closing parenthesis.`,
      );
    }
    consumeToken(state);
    return value;
  }

  const token = consumeToken(state);
  if (!token) {
    throw new Error(`${state.contextLabel} ended unexpectedly.`);
  }

  switch (token.kind) {
    case "number":
    case "string":
    case "boolean":
    case "null":
      return token.value;
    case "identifier": {
      if (!state.variables.has(token.value)) {
        throw new Error(
          `${state.contextLabel} references unknown variable "${token.value}".`,
        );
      }
      return state.variables.get(token.value) ?? null;
    }
    default:
      throw new Error(`${state.contextLabel} expected a value.`);
  }
};

const parseUnary = (state: ExpressionParserState): AutomationScriptValue => {
  if (matchesOperator(state, "!")) {
    consumeToken(state);
    return !coerceTruthiness(parseUnary(state));
  }
  if (matchesOperator(state, "-")) {
    consumeToken(state);
    return -coerceNumber(parseUnary(state), state.contextLabel);
  }
  return parsePrimary(state);
};

const parseMultiplicative = (
  state: ExpressionParserState,
): AutomationScriptValue => {
  let value = parseUnary(state);

  while (matchesOperator(state, "*") || matchesOperator(state, "/")) {
    const operator = consumeToken(state);
    const right = parseUnary(state);
    const leftNumber = coerceNumber(value, state.contextLabel);
    const rightNumber = coerceNumber(right, state.contextLabel);
    value =
      operator?.kind === "operator" && operator.value === "*"
        ? leftNumber * rightNumber
        : leftNumber / rightNumber;
  }

  return value;
};

const parseAdditive = (state: ExpressionParserState): AutomationScriptValue => {
  let value = parseMultiplicative(state);

  while (matchesOperator(state, "+") || matchesOperator(state, "-")) {
    const operator = consumeToken(state);
    const right = parseMultiplicative(state);

    if (operator?.kind === "operator" && operator.value === "+") {
      if (typeof value === "number" && typeof right === "number") {
        value = value + right;
      } else {
        value = `${stringifyScriptValue(value)}${stringifyScriptValue(right)}`;
      }
      continue;
    }

    value =
      coerceNumber(value, state.contextLabel) -
      coerceNumber(right, state.contextLabel);
  }

  return value;
};

const parseComparison = (
  state: ExpressionParserState,
): AutomationScriptValue => {
  let value = parseAdditive(state);

  while (
    matchesOperator(state, ">") ||
    matchesOperator(state, ">=") ||
    matchesOperator(state, "<") ||
    matchesOperator(state, "<=")
  ) {
    const operator = consumeToken(state);
    const right = parseAdditive(state);
    value = compareValues(
      value,
      right,
      operator?.kind === "operator" ? operator.value : ">",
      state.contextLabel,
    );
  }

  return value;
};

const parseEquality = (state: ExpressionParserState): AutomationScriptValue => {
  let value = parseComparison(state);

  while (matchesOperator(state, "==") || matchesOperator(state, "!=")) {
    const operator = consumeToken(state);
    const right = parseComparison(state);
    const equal = value === right;
    value =
      operator?.kind === "operator" && operator.value === "!=" ? !equal : equal;
  }

  return value;
};

const parseLogicalAnd = (
  state: ExpressionParserState,
): AutomationScriptValue => {
  let value = parseEquality(state);

  while (matchesOperator(state, "&&")) {
    consumeToken(state);
    const right = parseEquality(state);
    value = coerceTruthiness(value) && coerceTruthiness(right);
  }

  return value;
};

const parseLogicalOr = (
  state: ExpressionParserState,
): AutomationScriptValue => {
  let value = parseLogicalAnd(state);

  while (matchesOperator(state, "||")) {
    consumeToken(state);
    const right = parseLogicalAnd(state);
    value = coerceTruthiness(value) || coerceTruthiness(right);
  }

  return value;
};

const evaluateExpression = (
  expression: string,
  variables: Map<string, AutomationScriptValue>,
  contextLabel: string,
): AutomationScriptValue => {
  const state: ExpressionParserState = {
    tokens: tokenizeExpression(expression, contextLabel),
    index: 0,
    variables,
    contextLabel,
  };
  const value = parseLogicalOr(state);
  if (state.index < state.tokens.length) {
    throw new Error(`${contextLabel} has unexpected trailing input.`);
  }
  return value;
};

const coerceDuration = (
  value: AutomationScriptValue,
  contextLabel: string,
  max: number,
): number => {
  const parsed = Math.round(coerceNumber(value, contextLabel));
  if (parsed < 0 || parsed > max) {
    throw new Error(
      `${contextLabel} must resolve to an integer between 0 and ${max}.`,
    );
  }
  return parsed;
};

const findElseOrEndIfIndex = (
  statements: AutomationScriptStatement[],
  startIndex: number,
): number => {
  let depth = 0;
  for (let index = startIndex + 1; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement.kind === "if") {
      depth += 1;
      continue;
    }
    if (statement.kind === "endif") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
      continue;
    }
    if (statement.kind === "else" && depth === 0) {
      return index;
    }
  }
  return statements.length;
};

const findEndIfIndex = (
  statements: AutomationScriptStatement[],
  startIndex: number,
): number => {
  let depth = 0;
  for (let index = startIndex + 1; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement.kind === "if") {
      depth += 1;
      continue;
    }
    if (statement.kind === "endif") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }
  return statements.length;
};

export const executeAutomationScript = async (
  context: AutomationScriptExecutionContext,
): Promise<void> => {
  const label = context.label ?? "script";
  const statements = parseAutomationScript(context.script, label);
  const readOnlyVariableNames =
    context.readOnlyVariableNames ?? new Set<string>();

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    context.assertCanContinue?.();
    const statementLabel = formatStatementLabel(label, statement);

    switch (statement.kind) {
      case "set_variable": {
        if (readOnlyVariableNames.has(statement.variableName)) {
          throw new Error(
            `${statementLabel} cannot overwrite read-only variable "${statement.variableName}".`,
          );
        }
        if (
          !context.variables.has(statement.variableName) &&
          context.variables.size >= MAX_SCRIPT_VARIABLE_COUNT
        ) {
          throw new Error(
            `${statementLabel} exceeds the maximum variable count of ${MAX_SCRIPT_VARIABLE_COUNT}.`,
          );
        }
        context.variables.set(
          statement.variableName,
          evaluateExpression(
            statement.expression,
            context.variables,
            statementLabel,
          ),
        );
        break;
      }
      case "write_log":
        await context.log(
          stringifyScriptValue(
            evaluateExpression(
              statement.expression,
              context.variables,
              statementLabel,
            ),
          ),
        );
        break;
      case "speak":
        await context.speak(
          stringifyScriptValue(
            evaluateExpression(
              statement.expression,
              context.variables,
              statementLabel,
            ),
          ),
        );
        break;
      case "wait":
        await context.wait(
          coerceDuration(
            evaluateExpression(
              statement.expression,
              context.variables,
              statementLabel,
            ),
            statementLabel,
            MAX_WAIT_MS,
          ),
        );
        break;
      case "set_mic_state":
        await context.setMicState(statement.enabled);
        break;
      case "key_press": {
        const durationMs =
          statement.durationExpression === undefined
            ? undefined
            : coerceDuration(
                evaluateExpression(
                  statement.durationExpression,
                  context.variables,
                  statementLabel,
                ),
                statementLabel,
                MAX_KEY_HOLD_DURATION_MS,
              );
        await context.pressKey(statement.key, durationMs);
        break;
      }
      case "key_down":
        await context.keyDown(statement.key);
        break;
      case "key_up":
        await context.keyUp(statement.key);
        break;
      case "key_combination":
        await context.keyCombination(statement.modifiers, statement.key);
        break;
      case "call_command":
        await context.callCommand(statement.commandId);
        break;
      case "set_background":
        await context.setBackground(statement.backgroundId);
        break;
      case "restore_background":
        await context.restoreBackground();
        break;
      case "if":
        if (
          !coerceTruthiness(
            evaluateExpression(
              statement.condition,
              context.variables,
              statementLabel,
            ),
          )
        ) {
          index = findElseOrEndIfIndex(statements, index);
        }
        break;
      case "else":
        index = findEndIfIndex(statements, index);
        break;
      case "endif":
        break;
      case "return":
        return;
      default:
        throw new Error(
          `${statementLabel} uses unsupported script statement "${(statement as any).kind}".`,
        );
    }
  }
};
