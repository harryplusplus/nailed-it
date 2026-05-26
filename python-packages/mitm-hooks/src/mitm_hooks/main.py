import json
from typing import TYPE_CHECKING

from mitmproxy.http import Request

if TYPE_CHECKING:
    from mitmproxy.http import HTTPFlow


def _is_chat_completions(req: Request) -> bool:
    return req.method.lower() == "post" and req.path.endswith("/chat/completions")


class Hooks:
    def request(self, flow: HTTPFlow) -> None:
        if _is_chat_completions(flow.request):
            try:
                body = flow.request.json()
            except json.JSONDecodeError, TypeError:
                return

            if isinstance(body, dict):
                body["temperature"] = 0.0
                flow.request.content = json.dumps(body, ensure_ascii=False).encode()


addons = [Hooks()]
