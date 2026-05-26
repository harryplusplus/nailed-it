import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mitmproxy.http import HTTPFlow


class Hooks:
    def request(self, flow: HTTPFlow) -> None:
        if flow.request.method.lower() == "post" and flow.request.path.endswith(
            "/chat/completions"
        ):
            try:
                body = json.loads(flow.request.content)
                body["temperature"] = 0.0
                flow.request.content = json.dumps(body).encode()
            except json.JSONDecodeError, KeyError:
                pass


addons = [Hooks()]
