"""Tests for runtime source enable/disable environment flags."""

from __future__ import annotations

from openbiliclaw.runtime.source_flags import env_flag_enabled, xhs_disabled


def test_env_flag_enabled_accepts_common_truthy_values() -> None:
    for value in ["1", "true", "TRUE", "yes", "on"]:
        assert env_flag_enabled("FLAG", {"FLAG": value}) is True


def test_env_flag_enabled_rejects_empty_or_falsey_values() -> None:
    for value in ["", "0", "false", "no", "off"]:
        assert env_flag_enabled("FLAG", {"FLAG": value}) is False


def test_xhs_disabled_reads_openbiliclaw_no_xhs() -> None:
    assert xhs_disabled({"OPENBILICLAW_NO_XHS": "1"}) is True
    assert xhs_disabled({"OPENBILICLAW_NO_XHS": ""}) is False


def test_no_xhs_env_disables_runtime_xhs_producer(
    tmp_path,
    monkeypatch,
) -> None:
    from openbiliclaw.api.runtime_context import build_runtime_context
    from openbiliclaw.config import Config, LLMConfig, LLMProviderConfig

    monkeypatch.setenv("OPENBILICLAW_NO_XHS", "1")
    cfg = Config(
        data_dir=str(tmp_path / "data"),
        llm=LLMConfig(openai=LLMProviderConfig(api_key="sk-test")),
    )

    ctx = build_runtime_context(cfg)

    assert ctx.runtime_controller.xhs_producer is None
