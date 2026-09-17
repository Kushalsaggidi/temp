import type { TrustScore } from "@/contracts";

/** The single source of truth for which assets need attention, shared by the
 * Marketplace page, the Under construction page, and the Marketplace browser. */
export function needsAttention(item: { trust: TrustScore }): boolean {
  return item.trust.band === "attention" || item.trust.band === "blocked";
}
