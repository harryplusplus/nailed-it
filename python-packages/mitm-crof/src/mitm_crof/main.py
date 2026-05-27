"""mitmproxy addon — trim the in-memory flow list to bound memory usage.

When the total number of flows exceeds a configurable threshold, the oldest
flows are deleted so that only the most recent ``keep_after_trim`` remain.

Useful in long-running ``mitmweb`` sessions where the flow list would
otherwise grow unbounded over time.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from mitmproxy import ctx

if TYPE_CHECKING:
    from mitmproxy import http
    from mitmproxy.addons.view import View


class ViewLimiter:
    """Limit the in-memory flow view to control memory usage.

    When the total number of flows in the view exceeds ``max_flows``, the
    oldest flows are removed so that only the most recent
    ``keep_after_trim`` remain.
    """

    def __init__(self, max_flows: int = 100, keep_after_trim: int = 50) -> None:
        """Initialize with flow count limits.

        Args:
            max_flows: Maximum allowed flows before trimming begins.
            keep_after_trim: Number of most recent flows to preserve.

        """
        self._max_flows = max_flows
        self._keep_after_trim = keep_after_trim

    def response(self, flow: http.HTTPFlow) -> None:  # noqa: ARG002
        """Trim the flow list after each completed response.

        Called for **all** flows (not just traced ones).  When the view
        exceeds ``_max_flows``, the oldest flows are removed, leaving
        ``_keep_after_trim`` most recent flows in the list.

        ``ctx.master.view`` is only available in interactive/web mode
        (``FlowMaster``).  In dump mode (``mitmdump``) this is a no-op.

        Args:
            flow: The mitmproxy HTTP flow for the completed response.

        """
        view: View | None = getattr(ctx.master, "view", None)
        if view is None:
            return
        if len(view) <= self._max_flows:
            return
        delete_count = len(view) - self._keep_after_trim
        to_delete = list(view[:delete_count])
        view.remove(to_delete)


addons = [ViewLimiter()]
