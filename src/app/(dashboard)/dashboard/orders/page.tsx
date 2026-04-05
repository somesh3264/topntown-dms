import type { Metadata } from "next";
import { ComingSoon } from "../_components/ComingSoon";
export const metadata: Metadata = { title: "Orders" };
export default function OrdersPage() {
  return <ComingSoon title="Orders" description="Order management is under development." />;
}
