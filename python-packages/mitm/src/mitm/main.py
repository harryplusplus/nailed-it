"""mitmproxy addon — OpenInference LLM tracing with per-project Phoenix routing.

When a client sends a request with ``Authorization: Bearer <project_name>``,
this addon:

1. Strips the project name from the header and replaces it with the real
   crof.ai API key read from ``CROF_API_KEY``.
2. Creates an OpenInference LLM span capturing the request and response.
3. Routes the span to the correct Phoenix project via the ``x-project-name``
   OTLP HTTP header.

Architecture::

    Client  ──►  mitmproxy  ──►  crof.ai
    (api_key=     │
     project)     └─► Phoenix OTLP (x-project-name: <project>)
"""

from __future__ import annotations

import json
import os
from typing import TYPE_CHECKING, Any

from openinference.semconv.resource import ResourceAttributes
from openinference.semconv.trace import SpanAttributes
from opentelemetry import trace as trace_api
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from mitm.exporter import ProjectAwareOTLPSpanExporter, project_for_span_id

if TYPE_CHECKING:
    from mitmproxy import http

_HTTP_STATUS_ERROR_THRESHOLD = 400

_CROF_API_KEY = os.environ.get("CROF_API_KEY", "")
_PHOENIX_OTLP_ENDPOINT = "http://localhost:6006/v1/traces"

_resource = Resource.create({ResourceAttributes.PROJECT_NAME: "mitm"})
_tracer_provider = TracerProvider(resource=_resource)
_exporter = ProjectAwareOTLPSpanExporter(endpoint=_PHOENIX_OTLP_ENDPOINT)
_processor = BatchSpanProcessor(_exporter)
_tracer_provider.add_span_processor(_processor)
trace_api.set_tracer_provider(_tracer_provider)

_tracer = trace_api.get_tracer(__name__)


def _parse_project_name(flow: http.HTTPFlow) -> str | None:
    """Extract the Phoenix project name from the Authorization header.

    Args:
        flow: The mitmproxy HTTP flow.

    Returns:
        The project name string, or ``None`` if the header is missing or
        does not start with ``"Bearer "``.

    """
    auth = flow.request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    return auth.removeprefix("Bearer ").strip()


def _replace_auth_header(flow: http.HTTPFlow) -> None:
    """Replace the Authorization header with the real crof.ai API key.

    Args:
        flow: The mitmproxy HTTP flow whose Authorization header will be
            replaced.

    """
    flow.request.headers["Authorization"] = f"Bearer {_CROF_API_KEY}"


def _parse_json_body(content: bytes | None) -> dict[str, Any] | None:
    """Parse bytes as JSON into a dictionary.

    Args:
        content: The raw bytes to parse, or ``None``.

    Returns:
        The parsed dictionary, or ``None`` if the input is ``None`` or
        cannot be decoded as JSON.

    """
    if content is None:
        return None
    try:
        return json.loads(content)
    except json.JSONDecodeError, TypeError, ValueError:
        return None


def _is_chat_completions(flow: http.HTTPFlow) -> bool:
    """Determine whether the request targets the chat completions endpoint.

    Args:
        flow: The mitmproxy HTTP flow.

    Returns:
        ``True`` if the request path ends with ``/chat/completions``.

    """
    path = flow.request.path
    return path.rstrip("/").endswith("/chat/completions")


def _build_request_attrs(flow: http.HTTPFlow) -> dict[str, Any]:
    """Build OpenInference span attributes from the incoming request.

    When the request body is valid JSON the method extracts ``input.value``,
    ``llm.input_messages``, ``llm.invocation_parameters``, and
    ``llm.model_name`` in addition to HTTP-level attributes.

    Args:
        flow: The mitmproxy HTTP flow.

    Returns:
        A dictionary of OpenInference-compliant span attributes.

    """
    body = _parse_json_body(flow.request.content)

    attrs: dict[str, Any] = {
        SpanAttributes.OPENINFERENCE_SPAN_KIND: "LLM",
        SpanAttributes.INPUT_MIME_TYPE: "application/json",
        "http.method": flow.request.method,
        "http.url": str(flow.request.url),
        "http.request.headers": json.dumps(dict(flow.request.headers.items())),
    }

    if body is not None:
        attrs[SpanAttributes.INPUT_VALUE] = json.dumps(body)

        if "messages" in body:
            attrs[SpanAttributes.LLM_INPUT_MESSAGES] = json.dumps(body["messages"])

        invocation_params = {k: v for k, v in body.items() if k != "messages"}
        if invocation_params:
            attrs[SpanAttributes.LLM_INVOCATION_PARAMETERS] = json.dumps(
                invocation_params,
            )

        if "model" in body:
            attrs[SpanAttributes.LLM_MODEL_NAME] = body["model"]
    elif flow.request.content is not None:
        attrs[SpanAttributes.INPUT_VALUE] = flow.request.content.decode(
            "utf-8", errors="replace"
        )
        attrs[SpanAttributes.INPUT_MIME_TYPE] = "text/plain"

    return attrs


def _set_token_usage(span: trace_api.Span, usage: dict[str, Any]) -> None:
    """Set LLM token count attributes on an OpenInference span.

    Only non-``None`` values from the usage dict are set.  Expected keys
    are ``prompt_tokens``, ``completion_tokens``, and ``total_tokens``.

    Args:
        span: The OpenInference span to mutate.
        usage: A dictionary that may contain token count keys.

    """
    if "prompt_tokens" in usage:
        span.set_attribute(
            SpanAttributes.LLM_TOKEN_COUNT_PROMPT,
            usage["prompt_tokens"],
        )
    if "completion_tokens" in usage:
        span.set_attribute(
            SpanAttributes.LLM_TOKEN_COUNT_COMPLETION,
            usage["completion_tokens"],
        )
    if "total_tokens" in usage:
        span.set_attribute(
            SpanAttributes.LLM_TOKEN_COUNT_TOTAL,
            usage["total_tokens"],
        )


def _set_choice_attrs(span: trace_api.Span, choices: list[Any]) -> None:
    """Set output message and finish reason from the first response choice.

    Args:
        span: The OpenInference span to mutate.
        choices: The ``choices`` list from an OpenAI-compatible response.

    """
    if not choices:
        return
    first = choices[0]
    if not isinstance(first, dict):
        return
    if "message" in first:
        span.set_attribute(
            SpanAttributes.LLM_OUTPUT_MESSAGES,
            json.dumps([first["message"]]),
        )
    if "finish_reason" in first:
        span.set_attribute(
            SpanAttributes.LLM_FINISH_REASON,
            first["finish_reason"],
        )


def _set_response_attrs(span: trace_api.Span, flow: http.HTTPFlow) -> None:
    """Populate an OpenInference span with response attributes.

    This includes HTTP status code, duration, response body, model name,
    token usage, and output messages.  Handles non-JSON responses by
    storing the raw text.

    Args:
        span: The OpenInference span to mutate.
        flow: The mitmproxy HTTP flow whose response will be read.

    """
    resp = flow.response
    if resp is None:
        return

    span.set_attribute("http.status_code", resp.status_code)

    start = resp.timestamp_start
    end = resp.timestamp_end
    if start is not None and end is not None:
        duration_ms = (end - start) * 1000
        span.set_attribute("http.response.duration_ms", duration_ms)

    body = _parse_json_body(resp.content)

    if body is not None:
        span.set_attribute(SpanAttributes.OUTPUT_VALUE, json.dumps(body))
        span.set_attribute(
            SpanAttributes.OUTPUT_MIME_TYPE,
            "application/json",
        )

        if "model" in body:
            span.set_attribute(SpanAttributes.LLM_MODEL_NAME, body["model"])

        usage = body.get("usage")
        if isinstance(usage, dict):
            _set_token_usage(span, usage)

        choices = body.get("choices")
        if isinstance(choices, list):
            _set_choice_attrs(span, choices)
    elif resp.content is not None:
        raw_text = resp.content.decode("utf-8", errors="replace")
        span.set_attribute(SpanAttributes.OUTPUT_VALUE, raw_text)
        span.set_attribute(SpanAttributes.OUTPUT_MIME_TYPE, "text/plain")


class Addon:
    """mitmproxy addon — per-client Phoenix tracing via OpenInference.

    The addon intercepts requests to the chat completions endpoint,
    replaces the client-supplied Authorization header (which carries the
    Phoenix project name) with the real crof.ai API key, and creates an
    OpenInference LLM span for each request/response pair.  Spans are
    exported to Phoenix with the ``x-project-name`` header set so that
    each client's traces appear under its own project.
    """

    def request(self, flow: http.HTTPFlow) -> None:
        """Handle an incoming request before it is forwarded upstream.

        Steps:

        1. Parse the Phoenix project name from the ``Authorization`` header.
        2. Replace it with the real crof.ai API key.
        3. Create an OpenInference LLM span with request attributes.

        Non-chat-completion requests and requests without a valid Bearer
        token are forwarded without tracing.

        Args:
            flow: The mitmproxy HTTP flow for the incoming request.

        """
        project = _parse_project_name(flow)
        if project is None:
            return

        if not _is_chat_completions(flow):
            return

        _replace_auth_header(flow)

        attrs = _build_request_attrs(flow)

        span = _tracer.start_span(
            name=f"LLM {flow.request.method} {flow.request.path}",
            attributes=attrs,
            kind=trace_api.SpanKind.CLIENT,
        )

        # Register the project name so the exporter can route this span.
        ctx = span.get_span_context()
        span_id_hex = format(ctx.span_id, "032x") if ctx else ""
        project_for_span_id[span_id_hex] = project

        flow._span = span  # type: ignore[attr-defined]  # noqa: SLF001

    def response(self, flow: http.HTTPFlow) -> None:
        """Handle the upstream response before returning it to the client.

        Populates the corresponding OpenInference span with response
        attributes (status, body, token counts, model name), sets the
        span status, and ends the span.

        Args:
            flow: The mitmproxy HTTP flow for the completed response.

        """
        span: trace_api.Span | None = getattr(flow, "_span", None)
        if span is None:
            return

        _set_response_attrs(span, flow)

        resp = flow.response
        if resp is not None and resp.status_code >= _HTTP_STATUS_ERROR_THRESHOLD:
            span.set_status(
                trace_api.StatusCode.ERROR,
                f"HTTP {resp.status_code}",
            )
        else:
            span.set_status(trace_api.StatusCode.OK)

        span.end()
        del flow._span  # type: ignore[attr-defined]  # noqa: SLF001


addons = [Addon()]
