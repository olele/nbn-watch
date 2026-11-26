from __future__ import annotations

import os
from typing import Any

import pytest


@pytest.fixture(autouse=True)
def _restore_environ() -> Any:
    saved = dict(os.environ)
    yield
    os.environ.clear()
    os.environ.update(saved)
