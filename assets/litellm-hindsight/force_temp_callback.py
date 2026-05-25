"""Force temperature=0.0 on every LLM request headed to the Crof provider.

Hindsight's retain path sends temperature=0.1 and its consolidation path doesn't
send one at all.  This callback catches every /chat/completions request before it
leaves LiteLLM and pins temperature to 0.0 so Crof sees a consistent value
regardless of which Hindsight path originated the call.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from litellm.integrations.custom_logger import CustomLogger

if TYPE_CHECKING:
    from litellm.proxy.proxy_server import DualCache, UserAPIKeyAuth
    from litellm.types.utils import CallTypesLiteral


class ForceTemperatureCallback(CustomLogger):
    """Intercept every LLM request and pin its temperature to 0.0."""

    async def async_pre_call_hook(
        self,
        user_api_key_dict: UserAPIKeyAuth,  # noqa: ARG002
        cache: DualCache,  # noqa: ARG002
        data: dict,
        call_type: CallTypesLiteral,  # noqa: ARG002
    ) -> dict:
        """Override the request temperature to 0.0 before it hits the upstream."""
        data["temperature"] = 0.0
        return data


proxy_handler_instance = ForceTemperatureCallback()
