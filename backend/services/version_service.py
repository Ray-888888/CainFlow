import os
import re
from functools import lru_cache

from backend import config

_APP_VERSION_NUMBER_PATTERN = re.compile(
    r"export\s+const\s+APP_VERSION_NUMBER\s*=\s*['\"]([^'\"]+)['\"]"
)


def _get_constants_path():
    return os.path.join(config.STATIC_ROOT, 'js', 'core', 'constants.js')


@lru_cache(maxsize=1)
def get_app_version_number():
    try:
        with open(_get_constants_path(), 'r', encoding='utf-8') as file:
            content = file.read()
    except OSError:
        return '0.0.0'

    match = _APP_VERSION_NUMBER_PATTERN.search(content)
    if not match:
        return '0.0.0'
    return match.group(1).strip() or '0.0.0'


def get_app_version_tag():
    return f"v{get_app_version_number()}"


def get_app_user_agent():
    return f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) CainFlow/{get_app_version_number()}"


"""Shared backend helpers for reading the app version from js/core/constants.js."""
