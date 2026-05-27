"""Custom OTLP span exporter for per-project Phoenix routing.

The mitmproxy addon registers each span's Phoenix project name in the
module-level ``project_for_span_id`` dict keyed by span ID.  This exporter
consumes that mapping on each export cycle, groups spans by project, and
sends each group through a dedicated ``OTLPSpanExporter`` that includes the
``x-project-name`` HTTP header.

Phoenix resolves the project name in this order:
1. ``x-project-name`` HTTP header (highest precedence — we use this)
2. ``openinference.project.name`` OTLP resource attribute
3. Server default project name
"""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING

from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
    OTLPSpanExporter,
)
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

if TYPE_CHECKING:
    from collections.abc import Sequence

    from opentelemetry.sdk.trace import ReadableSpan

# Module-level mapping: span_id (hex) -> Phoenix project name.
# Set by the mitmproxy addon when creating a span, consumed (and removed)
# by the exporter on each export cycle.
project_for_span_id: dict[str, str] = {}


class ProjectAwareOTLPSpanExporter(SpanExporter):
    """An OTLP exporter that groups spans by Phoenix project name.

    The addon stores ``span_id -> project_name`` in the module-level
    ``project_for_span_id`` dict.  On export this exporter:

    1. Looks up each span's project name (defaults to ``"default"``).
    2. Sends each group via a dedicated ``OTLPSpanExporter`` that includes
       the ``x-project-name`` HTTP header.
    """

    def __init__(self, endpoint: str) -> None:
        """Initialize with the Phoenix OTLP HTTP endpoint URL.

        Args:
            endpoint: The full URL of the Phoenix OTLP HTTP endpoint,
                e.g. ``http://localhost:6006/v1/traces``.

        """
        self._endpoint = endpoint
        self._exporters: dict[str, OTLPSpanExporter] = {}

    def _exporter_for(self, project: str) -> OTLPSpanExporter:
        """Return (or create) a cached OTLPSpanExporter for a project.

        Each exporter is configured with an ``x-project-name`` header so
        that Phoenix routes the spans into the correct project regardless
        of the ``openinference.project.name`` resource attribute.

        Args:
            project: The Phoenix project name.

        Returns:
            A cached ``OTLPSpanExporter`` instance for the given project.

        """
        try:
            return self._exporters[project]
        except KeyError:
            exp = OTLPSpanExporter(
                endpoint=self._endpoint,
                headers={"x-project-name": project},
            )
            self._exporters[project] = exp
            return exp

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        """Export spans, grouped by Phoenix project name.

        Groups spans by looking up each span's project name from
        ``project_for_span_id``, then delegates each group to a
        project-specific ``OTLPSpanExporter``.

        Args:
            spans: A sequence of ended spans to export.

        Returns:
            ``SpanExportResult.SUCCESS`` if all groups were exported
            successfully, or the first failure result otherwise.

        """
        groups: dict[str, list[ReadableSpan]] = defaultdict(list)

        for span in spans:
            ctx = span.get_span_context()
            span_id_hex = format(ctx.span_id, "032x") if ctx else ""
            project = project_for_span_id.pop(span_id_hex, "default")
            groups[project].append(span)

        for project, group in groups.items():
            exporter = self._exporter_for(project)
            result = exporter.export(group)
            if result != SpanExportResult.SUCCESS:
                return result

        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        """Shut down all per-project exporters."""
        for exp in self._exporters.values():
            exp.shutdown()

    def force_flush(self, timeout_millis: int = 30_000) -> bool:
        """Force-flush all per-project exporters.

        Args:
            timeout_millis: Maximum time (in milliseconds) to wait for
                the flush to complete.

        Returns:
            ``True`` if all exporters flushed successfully, ``False``
            otherwise.

        """
        return all(exp.force_flush(timeout_millis) for exp in self._exporters.values())
