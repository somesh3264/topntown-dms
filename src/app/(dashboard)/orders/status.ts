// src/app/(dashboard)/orders/status.ts
// ---------------------------------------------------------------------------
// Plain module (NOT a Server Actions file) that holds the non-async exports
// used alongside the order server actions.
//
// Why separate from actions.ts?
//   Next.js requires every export from a "use server" file to be an async
//   function. Constants, types, and sync helpers cannot live in actions.ts —
//   they must be in a regular module like this one.
// ---------------------------------------------------------------------------

/**
 * Order statuses an admin is allowed to edit.
 *
 * - draft:     order is still being built; nothing downstream depends on it yet.
 * - confirmed: distributor placed the order before cut-off; bill not yet cut.
 * - billed:    advance bill has been generated but the stock has not been
 *              picked up from the factory. Editing in this window triggers a
 *              bill regeneration inside updateOrderItems().
 *
 * Anything else (dispatched, delivered, cancelled) is locked.
 */
export const ADMIN_EDITABLE_ORDER_STATUSES = ["draft", "confirmed", "billed"] as const;

export type AdminEditableStatus = (typeof ADMIN_EDITABLE_ORDER_STATUSES)[number];

export function isOrderEditableByAdmin(status: string): boolean {
  return (ADMIN_EDITABLE_ORDER_STATUSES as readonly string[]).includes(status);
}
