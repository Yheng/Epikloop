# Epic 3: Checkout

## 3.1 Cart page
- Tier: T1
- MVP: yes
- Requirements: REQ-CHECKOUT-002

The cart lists each item with its price, and the total with tax as its own line. Done when the
page matches design/screens/cart.html at both widths.

### Spec delta
- change REQ-CHECKOUT-002: the total shows tax as its own line

## 3.2 Sign-in before payment
- Tier: T3
- MVP: yes
- Requirements: REQ-CHECKOUT-001
- After: 3.1

Payment opens only for a signed-in person; anyone else is sent to sign in and returned to the
cart. Done when a signed-out request to the payment step is refused on the server.

### Spec delta
- none

## 3.3 Saved carts
- Tier: T2
- MVP: no
- Requirements: none

A signed-in person's cart is kept between visits.

### Spec delta
- add REQ-CHECKOUT-004: a signed-in person's cart is kept for 30 days
