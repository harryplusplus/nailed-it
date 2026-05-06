import logging
from typing import Any, cast

logger = logging.getLogger(__name__)


def register(ctx: Any) -> None:  # noqa: ANN401
    ctx.register_hook("pre_api_request", _on_pre_api_request)
    logger.debug("Registered.")


def _on_pre_api_request(**kwargs: Any) -> None:  # noqa: ANN401
    api_kwargs = kwargs.get("api_kwargs")
    if api_kwargs is None or not isinstance(api_kwargs, dict):
        return

    api_kwargs = cast("dict[str, Any]", api_kwargs)
    api_kwargs["temperature"] = 0

    model = cast("str", api_kwargs.get("model", ""))
    if model.startswith("deepseek"):
        api_kwargs["reasoning_effort"] = "max"
    else:
        api_kwargs["reasoning_effort"] = "high"

    provider = kwargs.get("provider")
    if provider == "crof":
        if model == "kimi-k2.6-precision":
            api_kwargs["max_tokens"] = 262144
        elif model == "glm-5.1-precision":
            api_kwargs["max_tokens"] = 202752
        elif model == "deepseek-v4-pro-precision":
            api_kwargs["max_tokens"] = 131072
