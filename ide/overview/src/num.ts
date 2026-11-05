/** A finite number from an endpoint's number or numeric string; anything else is null. */
export const num = (v: unknown) => (typeof v === "string" || typeof v === "number") && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
