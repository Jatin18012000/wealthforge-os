-- M10 market data: an optional ticker used only to fetch a live price.
-- Additive, nullable — every existing instrument keeps fetching nothing
-- (falls back to manual/last-known valuation) until a symbol is set.
ALTER TABLE "instrument" ADD COLUMN "marketSymbol" TEXT;
