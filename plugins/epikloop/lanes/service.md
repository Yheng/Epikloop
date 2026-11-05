# The service lane

## Plan

This lane has no screens and skips design. Each story that adds or changes an interface, such as
an endpoint, a command or a job's input and output, tests it against its contract in
`spec/architecture.md`. Staging, in 1.2, is the deployed service, and `staging_url` is a health
route that answers 2xx with an `x-commit` header naming the commit it was built from, from the
host's commit variable or `git rev-parse HEAD` at build; the retro's smoke passes only when that is
HEAD.

## Story

Each interface this story adds or changes has a test of its contract: what goes in, what comes
out, and the errors `spec/architecture.md` gives it.
