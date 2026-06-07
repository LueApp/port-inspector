"""Read-only inspection of local listening/bound sockets via ``/proc``.

Pure Python stdlib. The flow is:

1. Parse ``/proc/net/{tcp,tcp6}`` for sockets in state ``LISTEN`` and
   ``/proc/net/{udp,udp6}`` for bound (unconnected) datagram sockets. Each
   line gives us the local address, port, owning uid, and socket inode.
2. Walk ``/proc/<pid>/fd/*`` once, reading the ``socket:[inode]`` symlinks, to
   build an ``inode -> pid`` map. We can only read fds for processes the agent
   user owns (or everything, if run as root), so PID resolution is
   best-effort: address/port/uid always resolve, pid/process/cmd may not.
3. Enrich each socket with process name, command line, owning user, and a
   container-id hint pulled from the process cgroup.

Nothing here executes commands or writes anything.
"""
from __future__ import annotations

import os
import pwd
import re
import socket
from dataclasses import dataclass, field
from typing import Iterable

# Linux TCP state codes (net/tcp_states.h). We only care about LISTEN.
_TCP_LISTEN = "0A"
# Unconnected UDP sockets report TCP_CLOSE (07) as their "state".
_UDP_CLOSE = "07"

_PROC = "/proc"

# Matches the target of a /proc/<pid>/fd/<n> symlink that points at a socket.
_SOCKET_LINK_RE = re.compile(r"socket:\[(\d+)\]")

# Container-id hints inside a cgroup path. Covers cgroup v1 and v2 layouts for
# docker, containerd, podman/libpod, and CRI.
_CONTAINER_RES = (
    re.compile(r"docker[-/]([0-9a-f]{12,64})"),
    re.compile(r"libpod[-/]([0-9a-f]{12,64})"),
    re.compile(r"crio[-/]([0-9a-f]{12,64})"),
    re.compile(r"containerd.*?[-/]([0-9a-f]{12,64})"),
    # Generic kubepods / cri-containerd cgroup ending in a 64-hex id.
    re.compile(r"[-/]([0-9a-f]{64})(?:\.scope)?$"),
)


@dataclass
class Socket:
    protocol: str          # tcp | tcp6 | udp | udp6
    family: str            # ipv4 | ipv6
    address: str           # textual local address
    port: int
    scope: str             # loopback | all interfaces | private | multicast | specific
    exposed: bool          # reachable beyond this host (all-interfaces or global)
    all_interfaces: bool    # bound to 0.0.0.0 / ::
    uid: int
    user: str | None
    inode: int
    pid: int | None = None
    process: str | None = None
    command: str | None = None
    container_id: str | None = None

    def as_dict(self) -> dict:
        return {
            "protocol": self.protocol,
            "family": self.family,
            "address": self.address,
            "port": self.port,
            "scope": self.scope,
            "exposed": self.exposed,
            "all_interfaces": self.all_interfaces,
            "uid": self.uid,
            "user": self.user,
            "pid": self.pid,
            "process": self.process,
            "command": self.command,
            "container_id": self.container_id,
        }


# --- address parsing -------------------------------------------------------

def _parse_ipv4(hex_addr: str) -> str:
    """``0100007F`` -> ``127.0.0.1`` (the 4 bytes are little-endian)."""
    raw = bytes.fromhex(hex_addr)
    return socket.inet_ntop(socket.AF_INET, raw[::-1])


def _parse_ipv6(hex_addr: str) -> str:
    """32-hex /proc IPv6 -> textual.

    The kernel writes the 16 bytes as four host-byte-order (little-endian on
    x86) 32-bit words, so we reverse each 4-byte group before formatting.
    """
    raw = bytes.fromhex(hex_addr)
    reordered = bytearray(16)
    for i in range(4):
        word = raw[i * 4 : i * 4 + 4]
        reordered[i * 4 : i * 4 + 4] = word[::-1]
    return socket.inet_ntop(socket.AF_INET6, bytes(reordered))


def _parse_addr(token: str, family: str) -> tuple[str, int]:
    hex_addr, _, hex_port = token.partition(":")
    port = int(hex_port, 16)
    if family == "ipv6":
        return _parse_ipv6(hex_addr), port
    return _parse_ipv4(hex_addr), port


def classify_scope(address: str) -> tuple[str, bool, bool]:
    """Return (scope, all_interfaces, exposed) for a textual local address.

    - all_interfaces: bound to the unspecified address (0.0.0.0 / ::).
    - exposed: reachable from beyond this host — either all-interfaces or a
      globally-routable address. Loopback and private are not exposed.
    """
    import ipaddress

    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return "specific", False, False

    if ip.is_unspecified:
        return "all interfaces", True, True
    if ip.is_loopback:
        return "loopback", False, False
    if ip.is_multicast:
        # is_global is True for multicast, but a multicast group is only
        # reachable by joined members — not a unicast-exposed listener.
        return "multicast", False, False
    if ip.is_private or ip.is_link_local:
        return "private", False, False
    # A concrete, globally-routable address: a specific bind that is still
    # reachable off-box.
    return "specific", False, bool(ip.is_global)


# --- /proc/net parsing -----------------------------------------------------

def _read_proc_net(path: str, protocol: str, family: str, want_state: str) -> list[Socket]:
    sockets: list[Socket] = []
    try:
        with open(path, "r") as fh:
            lines = fh.readlines()
    except (FileNotFoundError, PermissionError, OSError):
        return sockets

    for line in lines[1:]:  # skip header
        parts = line.split()
        if len(parts) < 10:
            continue
        local = parts[1]
        rem = parts[2]
        state = parts[3]
        if state != want_state:
            continue
        # UDP "bound server" heuristic: no connected peer (remote port 0).
        # This drops outbound UDP client sockets while keeping listeners.
        if protocol.startswith("udp"):
            _, _, rem_port_hex = rem.partition(":")
            if int(rem_port_hex, 16) != 0:
                continue
        try:
            uid = int(parts[7])
            inode = int(parts[9])
            address, port = _parse_addr(local, family)
        except (ValueError, IndexError):
            continue
        # A bound UDP socket always has a non-zero local port; skip the
        # ephemeral/unbound ones.
        if protocol.startswith("udp") and port == 0:
            continue
        scope, all_ifaces, exposed = classify_scope(address)
        sockets.append(
            Socket(
                protocol=protocol,
                family=family,
                address=address,
                port=port,
                scope=scope,
                exposed=exposed,
                all_interfaces=all_ifaces,
                uid=uid,
                user=_username(uid),
                inode=inode,
            )
        )
    return sockets


def _username(uid: int) -> str | None:
    try:
        return pwd.getpwuid(uid).pw_name
    except (KeyError, OSError):
        return str(uid)


# --- inode -> pid mapping --------------------------------------------------

def _build_inode_pid_map(target_inodes: set[int]) -> dict[int, int]:
    """Walk ``/proc/<pid>/fd`` once, returning inode -> pid for sockets we care
    about. Unreadable processes (other users, without root) are skipped."""
    result: dict[int, int] = {}
    if not target_inodes:
        return result
    try:
        pids = [name for name in os.listdir(_PROC) if name.isdigit()]
    except OSError:
        return result

    for pid_s in pids:
        fd_dir = f"{_PROC}/{pid_s}/fd"
        try:
            fds = os.listdir(fd_dir)
        except (FileNotFoundError, PermissionError, NotADirectoryError, OSError):
            continue
        pid = int(pid_s)
        for fd in fds:
            try:
                target = os.readlink(f"{fd_dir}/{fd}")
            except OSError:
                continue
            m = _SOCKET_LINK_RE.fullmatch(target)
            if not m:
                continue
            inode = int(m.group(1))
            if inode in target_inodes and inode not in result:
                result[inode] = pid
        # Early exit once every target inode is mapped.
        if len(result) >= len(target_inodes):
            break
    return result


def _read_first_line(path: str) -> str | None:
    try:
        with open(path, "r") as fh:
            return fh.readline().strip()
    except OSError:
        return None


def _read_cmdline(pid: int) -> str | None:
    try:
        with open(f"{_PROC}/{pid}/cmdline", "rb") as fh:
            raw = fh.read()
    except OSError:
        return None
    if not raw:
        return None
    # cmdline is NUL-separated; trailing NUL produces an empty final field.
    parts = [p.decode("utf-8", "replace") for p in raw.split(b"\x00") if p]
    return " ".join(parts) if parts else None


def _container_hint(pid: int) -> str | None:
    try:
        with open(f"{_PROC}/{pid}/cgroup", "r") as fh:
            data = fh.read()
    except OSError:
        return None
    for line in data.splitlines():
        for rx in _CONTAINER_RES:
            m = rx.search(line)
            if m:
                return m.group(1)[:12]
    return None


def _enrich(sockets: Iterable[Socket]) -> None:
    socks = list(sockets)
    inode_pid = _build_inode_pid_map({s.inode for s in socks})
    # Cache per-pid metadata so two sockets from one process hit /proc once.
    meta_cache: dict[int, tuple[str | None, str | None, str | None]] = {}
    for s in socks:
        pid = inode_pid.get(s.inode)
        if pid is None:
            continue
        s.pid = pid
        if pid not in meta_cache:
            meta_cache[pid] = (
                _read_first_line(f"{_PROC}/{pid}/comm"),
                _read_cmdline(pid),
                _container_hint(pid),
            )
        s.process, s.command, s.container_id = meta_cache[pid]


# --- free-port suggestions -------------------------------------------------

def _free_suggestions(used_ports: set[int], candidates: list[int], limit: int) -> list[int]:
    out = []
    for port in candidates:
        if port not in used_ports:
            out.append(port)
            if len(out) >= limit:
                break
    return out


# --- public entrypoint -----------------------------------------------------

def scan(free_candidates: list[int], free_limit: int) -> dict:
    """Collect all listening/bound sockets and return the API payload body
    (without ``generated_at``, which the server stamps)."""
    sockets: list[Socket] = []
    sockets += _read_proc_net(f"{_PROC}/net/tcp", "tcp", "ipv4", _TCP_LISTEN)
    sockets += _read_proc_net(f"{_PROC}/net/tcp6", "tcp6", "ipv6", _TCP_LISTEN)
    sockets += _read_proc_net(f"{_PROC}/net/udp", "udp", "ipv4", _UDP_CLOSE)
    sockets += _read_proc_net(f"{_PROC}/net/udp6", "udp6", "ipv6", _UDP_CLOSE)

    _enrich(sockets)

    # Stable, useful order: externally-exposed first, then by port.
    sockets.sort(key=lambda s: (not s.exposed, s.port, s.protocol))

    listeners = [s.as_dict() for s in sockets]
    used_ports = {s.port for s in sockets}
    pids = {s.pid for s in sockets if s.pid is not None}

    summary = {
        "total_listeners": len(sockets),
        "unique_ports": len(used_ports),
        "process_count": len(pids),
        "tcp_count": sum(1 for s in sockets if s.protocol.startswith("tcp")),
        "udp_count": sum(1 for s in sockets if s.protocol.startswith("udp")),
        "all_interfaces_count": sum(1 for s in sockets if s.all_interfaces),
        "exposed_count": sum(1 for s in sockets if s.exposed),
        "unresolved_pid_count": sum(1 for s in sockets if s.pid is None),
    }

    return {
        "summary": summary,
        "listeners": listeners,
        "free_suggestions": _free_suggestions(used_ports, free_candidates, free_limit),
    }
