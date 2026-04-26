import logging
from typing import Any

logger = logging.getLogger(__name__)


def register(ctx: Any) -> None:  # noqa: ANN401
    ctx.register_hook("pre_api_request", _on_pre_api_request)
    logger.debug("Registered.")


def _on_pre_api_request(**kwargs: Any) -> None:  # noqa: ANN401
    api_kwargs = kwargs.get("api_kwargs")
    if api_kwargs is None or not isinstance(api_kwargs, dict):
        return

    api_kwargs["temperature"] = 0
    api_kwargs["reasoning_effort"] = "high"
