# Queue

## Questions

### Q-007 Guest checkout (2026-10-28)
- Blocks: 3.2
- Default taken: sign-in required before payment

Should people be able to pay without an account? 3.2 is built with sign-in required.

### Q-008 Split 3.3 (2026-10-29)
- Blocks: 3.3
- Default taken: 3.3 stopped, waiting for the split

Saved carts touch the cart, the session store and a cleanup job; they need more than one story.

### Q-009 Review 3.2 (2026-10-30)
- Blocks: nothing
- Default taken: landed as built
- Severity: high

The review of 3.2 found one thing:

1. `src/checkout/payment.ts:41` (high): a signed-out request reaches the payment step by its
   address, though 3.2 says the server refuses it. No test sends that request.

## Backlog

- 2026-10-28 The settings page loads slowly on mobile (seen in 2.3)
- 2026-10-30 Receipts could offer a PDF download
