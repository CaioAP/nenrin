// drizzle-kit emits migrations.js untyped. Without this declaration the import is an
// implicit any and `tsc --noEmit` fails under strict mode.
declare const migrations: {
  journal: {
    entries: { idx: number; when: number; tag: string; breakpoints: boolean }[];
  };
  migrations: Record<string, string>;
};

export default migrations;
