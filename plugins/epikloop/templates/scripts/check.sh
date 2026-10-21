#!/bin/sh
exec node "${0%/*}/../.githooks/check.mjs" "$@"
