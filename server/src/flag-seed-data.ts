// Initial day-flag values.
// NOTE (2026-11-17, GitHub archive): the seed data has been emptied for
// this repository. The original space contained real day-flag rows and
// reference dates here; this archive ships empty arrays.
// Inserted once by seedInitialFlags only when day_flags is empty;
// afterwards the user edits flags freely in the event form.

export const ANY_AMOUNT_REF_DATES: string[] = [];

export interface FlagSeedRow {
  date: string;
  salesUnreliable: number;
}

export const SEED_FLAGS: FlagSeedRow[] = [];
