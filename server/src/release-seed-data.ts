// Initial product release dates.
// NOTE (2026-11-17, GitHub archive): the seed data has been emptied for
// this repository. The original space contained real product release
// rows here; this archive ships an empty array.
// Inserted by seedProductReleaseDates with onConflictDoNothing, so a
// release date the user has already edited is never overwritten.

export interface ReleaseSeedRow {
  product: string;
  releaseDate: string;
  releaseBasis: string;
}

export const SEED_PRODUCT_RELEASES: ReleaseSeedRow[] = [];
