/*
 * HyperFrames Variable Injection System
 *
 * Source: heygen-com/hyperframes packages/producer/src/services/inlineSubCompositions.ts
 *
 * Variables are declared on the <html> element via data-variables JSON array.
 * Values are injected at render time via string replacement of {{variableId}}
 * placeholders. CSS custom properties (--var-{id}) are also updated.
 *
 * This enables pre-authored compositions to accept dynamic parameters without
 * regenerating HTML from scratch — the preferred path for /api/render-template.
 */

export type VariableType =
  | "string"
  | "number"
  | "color"
  | "boolean"
  | "enum";

export type CompositionVariable = {
  id: string;
  type: VariableType;
  default: string | number | boolean;
  options?: string[];
  label?: string;
};

export type VariableValues = Record<string, string | number | boolean>;

/**
 * Extract declared variables from a composition's <html data-variables='...'>.
 * Returns [] if no data-variables attribute is present or on any parse error.
 */
export function parseCompositionVariables(html: string): CompositionVariable[] {
  try {
    const single = html.match(/<html[^>]*data-variables='([^']+)'/);
    const double = !single
      ? html.match(/<html[^>]*data-variables="([^"]+)"/)
      : null;
    const raw = single?.[1] ?? double?.[1];
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw.replace(/&#39;/g, "'"));
    if (!Array.isArray(parsed)) return [];

    const variables: CompositionVariable[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).type === "string"
      ) {
        variables.push(item as CompositionVariable);
      }
    }
    return variables;
  } catch {
    return [];
  }
}

/**
 * Inject variable values into composition HTML.
 * Replaces {{variableId}} placeholders in text content.
 * Never throws — returns original html on any error.
 */
export function injectVariableValues(
  html: string,
  values: VariableValues,
): string {
  try {
    let result = html;
    for (const [id, value] of Object.entries(values)) {
      const placeholder = "{{" + id + "}}";
      const strValue = String(value);
      result = result.split(placeholder).join(strValue);
    }
    return result;
  } catch {
    return html;
  }
}

/**
 * Validate variable values against their declarations.
 * Returns an array of error messages (empty = valid).
 */
export function validateVariableValues(
  variables: CompositionVariable[],
  values: VariableValues,
): string[] {
  const errors: string[] = [];

  for (const variable of variables) {
    const hasValue = variable.id in values;
    const hasDefault =
      variable.default !== undefined &&
      variable.default !== null &&
      String(variable.default).length > 0;

    // Required variables (no default) must have a value.
    if (!hasValue && !hasDefault) {
      errors.push(
        `Missing required variable "${variable.id}" (type: ${variable.type})`,
      );
      continue;
    }

    const value = hasValue ? values[variable.id] : variable.default;

    if (variable.type === "enum") {
      if (
        variable.options &&
        !variable.options.includes(String(value))
      ) {
        errors.push(
          `Variable "${variable.id}" value "${String(value)}" is not in allowed options: [${variable.options.join(", ")}]`,
        );
      }
    }

    if (variable.type === "number") {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        errors.push(
          `Variable "${variable.id}" must be a finite number, got "${String(value)}"`,
        );
      }
    }

    if (variable.type === "color") {
      const str = String(value);
      if (
        !/^#[0-9a-fA-F]{3,6}$/.test(str) &&
        !/^#[0-9a-fA-F]{8}$/.test(str)
      ) {
        errors.push(
          `Variable "${variable.id}" must be a valid hex color, got "${str}"`,
        );
      }
    }
  }

  return errors;
}

/**
 * Combined operation: parse → validate → inject.
 * Throws TypeError with all validation errors joined if validation fails.
 */
export function buildVariableInjectedHtml(
  compositionHtml: string,
  values: VariableValues,
): string {
  const variables = parseCompositionVariables(compositionHtml);

  if (variables.length === 0) {
    // No variables declared — still do the injection in case of manual placeholders.
    return injectVariableValues(compositionHtml, values);
  }

  const errors = validateVariableValues(variables, values);
  if (errors.length > 0) {
    throw new TypeError(
      "Variable validation failed:\n" + errors.join("\n"),
    );
  }

  return injectVariableValues(compositionHtml, values);
}
