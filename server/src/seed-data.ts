// One-time seed payload: sales aggregated to date x product.
// NOTE (2026-11-17, GitHub archive): the seed data has been emptied for
// this repository. The original space contained real sales rows here;
// this archive ships an empty array so no sales figures are included.
// Privacy: contains no order IDs, payment IDs, customer data, device
// names, card details, or store name.
export interface SeedSaleRow {
  date: string;
  product: string;
  category: string;
  qty: number;
  gross: number;
  net: number;
  tx: number;
}

export const SEED_SALES: SeedSaleRow[] = [];
