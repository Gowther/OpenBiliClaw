"""Runtime source enable/disable flags."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Mapping

_TRUE_VALUES = {"1", "true", "yes", "on"}


def env_flag_enabled(name: str, env: Mapping[str, str] | None = None) -> bool:
    """Return True when an environment flag is set to a truthy value."""
    source = env if env is not None else os.environ
    return source.get(name, "").strip().lower() in _TRUE_VALUES


def xhs_disabled(env: Mapping[str, str] | None = None) -> bool:
    """Return True when Xiaohongshu integration is explicitly disabled."""
    return env_flag_enabled("OPENBILICLAW_NO_XHS", env)
