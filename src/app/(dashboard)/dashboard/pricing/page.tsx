import type { Metadata } from "next";
import { ComingSoon } from "../_components/ComingSoon";
export const metadata: Metadata = { title: "Pricing" };
export default function PricingPage() {
  return <ComingSoon title="Pricing Engine" description="Price overrides and discount slabs management is under development." />;
}
