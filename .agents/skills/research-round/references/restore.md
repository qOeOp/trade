# Backup restore drill

Read when checking that the ledger backup restores.

- **J.6.2.2** Restore only into an isolated ledger under the temporary root (`ledger temp`), never
  the active ledger. With the reader account, export at one fixed ledger commit every candidate
  source and evidence bundle from the restored ledger and from the original (`candidate export
  --at`, `evidence export --at`) and compare their SHA-256 byte for byte. The backup is valid only
  when all match; record the commit, the counts and every mismatch as an evidence bundle.
