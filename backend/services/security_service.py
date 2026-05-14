import ipaddress
import json
import os
import socket
import ssl
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

from backend import config, state

DEFAULT_ALLOWED_HOSTS = {
    '6789api.top',
    'www.6789api.top',
    'api.github.com',
    'github.com',
}

BLOCKED_HOSTNAMES = {
    'localhost',
    'localhost.localdomain',
}

COMMON_PROXY_CANDIDATES = [
    {'ip': '127.0.0.1', 'port': '7890', 'name': 'Clash / Mihomo HTTP'},
    {'ip': '127.0.0.1', 'port': '7897', 'name': 'Clash Verge / Mihomo mixed'},
    {'ip': '127.0.0.1', 'port': '7891', 'name': 'Clash controller proxy'},
    {'ip': '127.0.0.1', 'port': '10809', 'name': 'v2rayN / Xray HTTP'},
    {'ip': '127.0.0.1', 'port': '20171', 'name': 'Hiddify / local proxy'},
    {'ip': '127.0.0.1', 'port': '20172', 'name': 'Hiddify / local proxy alt'},
    {'ip': '127.0.0.1', 'port': '8080', 'name': 'Generic HTTP proxy'},
]


def _normalize_hostname(value):
    raw = str(value or '').strip().lower().rstrip('.')
    if not raw:
        return ''

    parsed = urlparse(raw if '://' in raw else f'//{raw}')
    host = parsed.hostname or raw.split('/', 1)[0].split('?', 1)[0].split('#', 1)[0]
    host = host.strip().lower().rstrip('.')
    if not host:
        return ''

    try:
        return host.encode('idna').decode('ascii')
    except UnicodeError:
        return ''


def _get_allowed_hosts():
    hosts = set(DEFAULT_ALLOWED_HOSTS)
    for host in state.CUSTOM_ALLOWED_HOSTS:
        normalized = _normalize_hostname(host)
        if normalized:
            hosts.add(normalized)
    return hosts


def _is_blocked_ip(ip):
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _host_matches_allowed_domain(host, allowed_host):
    return host == allowed_host or host.endswith(f'.{allowed_host}')


def load_allowed_hosts():
    if os.path.exists(config.ALLOWED_HOSTS_FILE):
        try:
            with open(config.ALLOWED_HOSTS_FILE, 'r', encoding='utf-8') as file:
                data = json.load(file)
                state.CUSTOM_ALLOWED_HOSTS[:] = data.get('hosts', [])
        except Exception as exc:
            print(f'Warning: Failed to load {config.ALLOWED_HOSTS_FILE}: {exc}')
    else:
        save_allowed_hosts([])


def save_allowed_hosts(hosts=None):
    if hosts is not None:
        state.CUSTOM_ALLOWED_HOSTS[:] = hosts
    payload = {
        'hosts': state.CUSTOM_ALLOWED_HOSTS,
        'description': '将您的 API 供应商域名添加到此列表中，以允许节点访问其服务器'
    }
    try:
        with open(config.ALLOWED_HOSTS_FILE, 'w', encoding='utf-8') as file:
            json.dump(payload, file, indent=2, ensure_ascii=False)
    except Exception as exc:
        print(f'Error: Failed to save {config.ALLOWED_HOSTS_FILE}: {exc}')


def _can_open_proxy_socket(ip, port, timeout):
    try:
        port_number = int(str(port).strip())
    except (TypeError, ValueError):
        return False
    if port_number <= 0 or port_number > 65535:
        return False
    try:
        with socket.create_connection((str(ip).strip() or '127.0.0.1', port_number), timeout=timeout):
            return True
    except OSError:
        return False


def check_proxy_health(ip, port, request_timeout=5.0, connect_timeout=0.8):
    if not _can_open_proxy_socket(ip, port, connect_timeout):
        return False, 'Proxy port is not reachable'
    proxy_url = f'http://{ip}:{port}'
    proxy_handler = urllib.request.ProxyHandler({'http': proxy_url, 'https': proxy_url})
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    opener = urllib.request.build_opener(proxy_handler, urllib.request.HTTPSHandler(context=context))
    try:
        start = time.perf_counter()
        request = urllib.request.Request('https://www.google.com', method='HEAD')
        opener.open(request, timeout=request_timeout)
        latency = int((time.perf_counter() - start) * 1000)
        return True, latency
    except urllib.error.HTTPError:
        return True, 'HTTP Error'
    except Exception as exc:
        return False, str(exc)


def detect_available_proxy():
    for candidate in COMMON_PROXY_CANDIDATES:
        success, result = check_proxy_health(
            candidate.get('ip', '127.0.0.1'),
            candidate.get('port', ''),
            request_timeout=3.0,
            connect_timeout=0.35,
        )
        if success:
            latency = result if isinstance(result, int) else 0
            return {
                'ip': str(candidate.get('ip') or '127.0.0.1'),
                'port': str(candidate.get('port') or ''),
                'name': str(candidate.get('name') or 'Local proxy'),
                'latency': latency,
            }
    return None


def is_safe_url(url, allow_private_network_targets=False):
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return False
        host = _normalize_hostname(parsed.hostname)
        if not host:
            return False
        if allow_private_network_targets:
            return True
        if host in BLOCKED_HOSTNAMES:
            return False

        allowed_hosts = _get_allowed_hosts()
        try:
            ip = ipaddress.ip_address(host)
            if _is_blocked_ip(ip):
                return False
            return host in allowed_hosts
        except ValueError:
            return any(_host_matches_allowed_domain(host, allowed_host) for allowed_host in allowed_hosts)
    except Exception:
        return False


def get_safe_path(name):
    safe_name = os.path.basename(name)
    if not safe_name or safe_name in ('.', '..'):
        return None
    filepath = os.path.join(config.WORKFLOWS_DIR, f'{safe_name}.json')
    abs_root = os.path.abspath(config.WORKFLOWS_DIR)
    abs_file = os.path.abspath(filepath)
    if not abs_file.startswith(abs_root):
        return None
    return filepath
"""提供允许域名管理、代理健康检查和 URL 安全校验能力。"""
