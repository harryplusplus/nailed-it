from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mitmproxy.http import HTTPFlow


class Hooks:
    def request(self, flow: HTTPFlow):
        if flow.request.method.lower() == "post" and flow.request.path.endswith(
            "/chat/completions"
        ):
            pass


addons = [Hooks()]
