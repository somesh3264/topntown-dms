import type { Metadata } from "next";
import { ComingSoon } from "../_components/ComingSoon";
export const metadata: Metadata = { title: "My Network" };
export default function NetworkPage() {
  return <ComingSoon title="My Network" description="Distributor network management is under development." />;
}
