from urllib.parse import parse_qs, urlparse

from backend import config
from backend.services.http_helpers import read_json_body, write_error, write_json
from backend.services.update_service import (
    cancel_update_download,
    get_update_download_status,
    start_update_download,
)


def handle_get(handler):
    parsed = urlparse(handler.path)
    if parsed.path != '/api/update/status':
        return False

    params = parse_qs(parsed.query or '')
    job_id = (params.get('jobId') or [''])[0]
    write_json(handler, get_update_download_status(job_id))
    return True


def handle_post(handler):
    parsed = urlparse(handler.path)
    path = parsed.path

    if path == '/api/update/download':
        try:
            data = read_json_body(handler)
            repo = str(data.get('repo') or config.GITHUB_REPO).strip()
            result = start_update_download(repo)
            write_json(handler, result)
        except Exception as error:
            write_error(handler, 500, '启动更新下载失败', error)
        return True

    if path == '/api/update/cancel':
        try:
            data = read_json_body(handler)
            job_id = str(data.get('jobId') or '').strip()
            result = cancel_update_download(job_id)
            write_json(handler, result, status=200 if result.get('success') else 404)
        except Exception as error:
            write_error(handler, 500, '取消更新下载失败', error)
        return True

    return False


"""Route handlers for CainFlow self-update downloads."""
