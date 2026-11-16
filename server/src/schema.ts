// Schema for 同人誌売上管理 (doujin sales ledger).
//
// Two tables:
//   sales  — Square sales aggregated to (date, product). Privacy by design:
//            no order IDs, payment IDs, customer data, device names, card
//            details, or store names are ever stored.
//   events — the user's own event registrations, one row per date, joined
//            to sales by date. Event info is entered by the user only.

import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sales = sqliteTable(
  "sales",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(), // YYYY-MM-DD (Asia/Tokyo event day)
    product: text("product").notNull(),
    category: text("category").notNull().default(""),
    qty: real("qty").notNull().default(0),
    gross: integer("gross").notNull().default(0), // yen
    net: integer("net").notNull().default(0), // yen
    tx: integer("tx").notNull().default(0), // transaction count
    // 完売 (sold out): the user records, per date x product, that the
    // copies brought to that event ran out — i.e. demand exceeded the
    // stock taken. Set only by hand in the in-app sales editor; Square
    // CSV imports never carry it (default 0) and re-imports preserve
    // the stored value.
    soldOut: integer("sold_out").notNull().default(0), // 0/1
  },
  (t) => [uniqueIndex("sales_date_product_idx").on(t.date, t.product)],
);

export const events = sqliteTable("events", {
  date: text("date").primaryKey(), // YYYY-MM-DD
  eventName: text("event_name").notNull().default(""),
  venue: text("venue").notNull().default(""),
  prefecture: text("prefecture").notNull().default(""),
  city: text("city").notNull().default(""),
  note: text("note").notNull().default(""),
  // Manual event-type override: the `key` of one row in the
  // `event_types` table, set by hand in the event edit form or the
  // bulk 種別設定 in イベント管理. "" means no manual setting — the
  // type then falls back to the automatic classification from the
  // event name. A non-empty value always wins over the automatic
  // classification everywhere the type is shown or aggregated.
  // Deleting a type clears this column on the events that used it,
  // so a stored value always names an existing type.
  eventType: text("event_type").notNull().default(""),
});

// Event types, user-editable (イベント管理 → イベント種別の管理）.
// Seeded once with the eleven built-in types (comiket / comitia /
// designfesta / bungaku / zinefes / comiccity / sunshine / omobaza /
// touhou / techbook / other, in that order — the original six plus
// the five master-list systems added 2026-11-16); afterwards the
// user can add, rename, re-keyword, reorder, and delete types.
//   key       — stable identifier stored in events.event_type. The
//               built-ins keep their original keys so existing manual
//               settings survive; user-added types get generated
//               "custom-…" keys. Renaming a type changes only its
//               label, never its key.
//   keywords  — comma-separated words for the automatic
//               classification: an event whose name contains one of
//               them (fuzzy-matched) is classified as this type.
//               Classification walks the list in sortOrder, so the
//               order is the priority order.
//   sortOrder — position in the list (classification priority and
//               display order everywhere types are listed).
//   The "other" type （その他） is locked: loadEventTypes always
//   surfaces it first regardless of its stored sort_order, and
//   saveEventTypes forces it to the front with its keywords cleared
//   (restoring it when a submission omits it), so it can never be
//   deleted or moved down. The pin is display-only — with no
//   keywords it never wins the classification walk, so it stays the
//   fallback for names no type matches.
export const eventTypes = sqliteTable(
  "event_types",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull(),
    label: text("label").notNull().default(""),
    keywords: text("keywords").notNull().default(""), // comma-separated
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("event_types_key_idx").on(t.key)],
);

// Per-date flags, kept separate from `events` so a flag can be set on a
// date that has sales but no event registration yet.
//   salesUnreliable — 「売り上げは参考情報」: the day's figures may be
//                     incompletely entered (seeded for days with <= 5
//                     copies sold in total).
// (The retired day-level 「新刊あり」 flag / note columns were dropped
// in migration 0011; 「新刊」 is judged per product from its release
// date instead. The stored values were exported to
// ~/workspace/doujin-sales/removed-data-backup-2026-11-16.md first.)
// Per-product release info, keyed by the exact product name used in
// `sales`. Kept separate from `sales` so a release date can be recorded
// (and edited) without touching sales rows. Products with no row here
// simply have no release date set; the UI then falls back to showing the
// placeholder date 2000-01-01 as the effective release date for
// sorting/calculations (the first sales date is still shown as an
// estimate (推定) alongside in the product detail).
//   releaseDate     — YYYY-MM-DD, or "" when only a basis note exists.
//   releaseBasis    — where the date came from (blog announcement etc.).
//   salesUnreliable — product-level 「除外」 flag (stored under its
//                     original name): this product's recorded figures
//                     may be unreliable (e.g. price-named entries like
//                     「500」「100」 or the 『任意の金額』 lump sum).
//                     The product-level counterpart of
//                     day_flags.salesUnreliable.
export const productReleases = sqliteTable("product_releases", {
  product: text("product").primaryKey(),
  releaseDate: text("release_date").notNull().default(""), // YYYY-MM-DD or ""
  releaseBasis: text("release_basis").notNull().default(""),
  // 廃盤 (out of print / no longer brought to events). Never inferred
  // from sales data — the user sets it by hand; default is not set.
  discontinued: integer("discontinued").notNull().default(0), // 0/1
  salesUnreliable: integer("sales_unreliable").notNull().default(0), // 0/1
});

// Product name aliases created by a user-run product merge: sales
// imported later under an old name (alias) are stored under the
// canonical product instead. Aliases are only ever created by the
// merge action — never automatically.
export const productAliases = sqliteTable("product_aliases", {
  alias: text("alias").primaryKey(), // old product name
  canonical: text("canonical").notNull(), // product name it merges into
});

// Merge history with a full snapshot of the affected sales rows,
// release rows, and re-pointed aliases, so a merge can be undone
// exactly (same-day rows that were summed are restored from the
// snapshot). `sources` is a JSON array of the merged-away names.
export const productMerges = sqliteTable("product_merges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: text("created_at").notNull(), // ISO timestamp
  canonical: text("canonical").notNull(),
  sources: text("sources").notNull(), // JSON string[]
  snapshot: text("snapshot").notNull(), // JSON snapshot (see actions.ts)
});

// (The product_series / product_series_members tables were dropped in
// migration 0011 together with the series actions; the registered
// series data was exported to
// ~/workspace/doujin-sales/removed-data-backup-2026-11-16.md first.)

export const dayFlags = sqliteTable("day_flags", {
  date: text("date").primaryKey(), // YYYY-MM-DD
  salesUnreliable: integer("sales_unreliable").notNull().default(0), // 0/1
});

// Standard event master list (標準イベント一覧・マスター), seeded once
// from the prepared events-master.csv (1,233 rows) and replaceable
// wholesale from the CSV取込 screen. REFERENCE ONLY: these rows are
// candidates shown in the event registration / edit form and in the
// unregistered-days check. They are never participation records —
// nothing here is joined into the events table, prefecture visit
// counts, participation counts, or registered counts. Several rows
// may share one date (multiple events on the same day); the user
// always picks which one applies — nothing is auto-selected.
//   note — the source citation from the CSV (「出典:URL」). Shown with
//          the candidate as provenance; never copied into the event
//          registration's own note field.
// Per-date inventory memos （在庫メモ）: what the user plans to send /
// bring to an event on that date. Kept separate from `events` and
// `sales` — like day_flags — so a memo can be saved for a future
// event date that has an event registration but no sales yet (the
// main use case), and so deleting an event registration or importing
// sales never touches it. A memo row exists only while it has
// content: saveInventoryMemo deletes the row (and its items) when
// URL, free memo, and every item count are all empty.
//   url  — one link for the date (official event site etc.).
//   memo — free-text note.
// The per-product counts live in inventory_items (one row per
// date x product, qty = copies sent / to bring). Only counts > 0 are
// stored; a product with no row for the date simply has no count.
export const inventoryMemos = sqliteTable("inventory_memos", {
  date: text("date").primaryKey(), // YYYY-MM-DD
  url: text("url").notNull().default(""),
  memo: text("memo").notNull().default(""),
});

export const inventoryItems = sqliteTable(
  "inventory_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(), // YYYY-MM-DD
    product: text("product").notNull(),
    qty: integer("qty").notNull().default(0), // copies sent / to bring
  },
  (t) => [uniqueIndex("inventory_items_date_product_idx").on(t.date, t.product)],
);

export const masterEvents = sqliteTable("master_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  eventName: text("event_name").notNull().default(""),
  venue: text("venue").notNull().default(""),
  prefecture: text("prefecture").notNull().default(""),
  city: text("city").notNull().default(""),
  note: text("note").notNull().default(""),
});
