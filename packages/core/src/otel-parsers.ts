export function unwrapOtelValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue", "bytesValue"]) {
    if (key in object) return object[key];
  }
  if (Array.isArray(object.arrayValue)) return object.arrayValue.map(unwrapOtelValue);
  if (object.arrayValue && typeof object.arrayValue === "object") {
    const values = (object.arrayValue as Record<string, unknown>).values;
    if (Array.isArray(values)) return values.map(unwrapOtelValue);
  }
  return object;
}

export function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function parseJsonRecordString(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseJsonString(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function isObservationLevel(value: string | undefined): value is "DEBUG" | "DEFAULT" | "WARNING" | "ERROR" {
  return value === "DEBUG" || value === "DEFAULT" || value === "WARNING" || value === "ERROR";
}
