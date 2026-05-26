import mitmproxy


class Hooks:
    def request(self, flow: mitmproxy.http.HTTPFlow):
        pass


addons = [Hooks()]
