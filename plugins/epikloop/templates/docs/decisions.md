# Decisions

## DECISION-001 Postgres for orders (2026-10-26)
- Context: orders need transactions, and two app instances write them at once.
- Decision: Postgres, through the host's managed database.
- Rejected: SQLite, because it allows one writer at a time.
- Trade-offs: a managed database costs more than a file and needs a connection secret.
- Implementation note: 1.1 sets up the schema as code and its migrations.

## DECISION-002 Receipts by email only (2026-10-27)
- Answers: Q-006
- Context: the batch took email receipts as its default while building 2.4.
- Decision: email receipts only, for the MVP.
- Rejected: printable receipts, because nobody asked for them yet.
- Trade-offs: people who lose the email ask support for a copy.
- Implementation note: 2.4 already took this default; nothing to rework.
