## What does this change?

## Checklist
- [ ] `uv run ruff check . && uv run mypy nbn_watch && uv run pytest tests/` pass
- [ ] New driver? Tests replay captured pages, incl. a bad-password case; `experimental = True` until confirmed on a real modem
- [ ] No credentials or personal data logged, stored or sent anywhere new
