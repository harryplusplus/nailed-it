from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mitmproxy.http import HTTPFlow


class Hooks:
    def request(self, flow: HTTPFlow):
        pass


addons = [Hooks()]
