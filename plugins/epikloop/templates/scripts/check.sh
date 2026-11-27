#!/bin/sh
[ -r "/proc/$PPID/winpid" ] && read -r CHECK_STARTER <"/proc/$PPID/winpid" && export CHECK_STARTER
exec node "${0%/*}/../.githooks/check.mjs" "$@"
