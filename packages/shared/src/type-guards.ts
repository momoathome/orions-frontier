/** `includes` für `as const`-Listen: nimmt jeden Wert und engt ihn auf den Listentyp ein. */
export const isOneOf = <T>(list: readonly T[], value: unknown): value is T =>
  list.some((item) => item === value);

/** `Object.entries` mit den Schlüsseln des Objekttyps statt `string`. */
export const entriesOf = <K extends string, V>(record: Partial<Record<K, V>>) =>
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Object.entries verliert den Schlüsseltyp; die Werte stammen aus `record`.
  Object.entries(record) as [K, V][];

/** `key in record` mit Einengung auf die Schlüssel des Objekts. */
export const isKeyOf = <T extends object>(record: T, key: PropertyKey): key is keyof T =>
  key in record;

/** Ersatz für `!`: wirft, wenn ein Wert laut Datenmodell existieren muss, aber fehlt. */
export const required = <T>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
};
