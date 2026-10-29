#!/bin/sh
# trade-ide-pull ledger|market: fast-forward the IDE copy; repair-market retains history before repair.
# Exit status 3: the public copy's history no longer descends from this copy; nothing is reset.
exec python3 /opt/trade/services/ide/docker/replica.py "$@"
