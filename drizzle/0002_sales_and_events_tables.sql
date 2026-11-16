DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  product TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  gross INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL DEFAULT 0,
  tx INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_date_product_idx ON sales (date, product);
--> statement-breakpoint
CREATE TABLE events (
  date TEXT PRIMARY KEY,
  event_name TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  prefecture TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
