# The service lane

## Plan

This lane has no screens and skips design. Each story that adds or changes an interface, such as
an endpoint, a command or a job's input and output, tests it against its contract in
`spec/architecture.md`. Staging, in 1.2, is the deployed service, and `staging_url` is a health
route that answers 2xx.

## Story

Each interface this story adds or changes has a test of its contract: what goes in, what comes
out, and the errors `spec/architecture.md` gives it.
