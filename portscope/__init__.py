"""portscope — local read-only port-occupation agent.

Reads Linux ``/proc/net/{tcp,tcp6,udp,udp6}`` and reports listening TCP
sockets and bound UDP sockets over a small localhost-only JSON API. The
public static dashboard fetches this API directly from the user's browser.

No data leaves the machine: the server binds ``127.0.0.1`` by default and
only echoes CORS headers back to a configured origin allowlist.
"""

__version__ = "0.1.0"
