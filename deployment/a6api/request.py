#!/usr/bin/env python3
"""One A6API request over authenticated SSH stdin/stdout. No listening socket."""
import http.client
import json
import os
import stat
import sys
import urllib.error
import urllib.request

KEY_FILE = '/etc/royal-a6api/key'
UPSTREAM = 'https://api.a6api.com'
MAX_BODY = 32 * 1024 * 1024
ROUTES = {
    ('GET', '/v1/models'),
    *[('POST', '/v1/' + path) for path in (
        'chat/completions', 'responses', 'images/generations', 'images/edits',
        'embeddings', 'audio/speech', 'audio/transcriptions', 'messages')],
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def header(output, status, content_type):
    output.write((json.dumps({'status': status, 'contentType': content_type}) + '\n').encode())
    output.flush()


def fail(output, status, code):
    header(output, status, 'application/json')
    output.write(json.dumps({'error': {'code': code}}).encode())


def run(source, output, key_file=KEY_FILE, opener=None):
    try:
        line = source.readline(4097)
        if len(line) > 4096 or not line.endswith(b'\n'):
            raise ValueError()
        meta = json.loads(line)
        method, path = meta['method'], meta['path']
        size, content_type = meta['length'], meta.get('contentType', 'application/json')
        if (method, path) not in ROUTES:
            return fail(output, 404, 'route_not_allowed')
        if (type(size) is not int or not 0 <= size <= MAX_BODY
                or (method == 'GET' and size != 0)
                or not isinstance(content_type, str) or len(content_type) > 256
                or any(ord(c) < 32 or ord(c) > 126 for c in content_type)):
            raise ValueError()
        body = source.read(size)
        if len(body) != size or source.read(1):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        return fail(output, 400, 'invalid_request')
    try:
        fd = os.open(key_file, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as credential:
            info = os.fstat(credential.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
                raise ValueError()
            key = credential.read(4096).strip()
        if not key or any(ord(c) < 33 or ord(c) > 126 for c in key):
            raise ValueError()
    except (OSError, ValueError):
        return fail(output, 503, 'credential_unavailable')
    headers = {'Authorization': 'Bearer ' + key, 'Content-Type': content_type,
               'Accept-Encoding': 'identity'}
    if path == '/v1/messages':
        headers.update({'x-api-key': key, 'anthropic-version': '2023-06-01'})
    request = urllib.request.Request(UPSTREAM + path, data=body if method == 'POST' else None,
                                     method=method, headers=headers)
    opener = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        try:
            response = opener.open(request, timeout=300)
        except urllib.error.HTTPError as error:
            if 300 <= error.code < 400:
                error.close()
                return fail(output, 502, 'upstream_redirect_rejected')
            response = error
    except (OSError, urllib.error.URLError, http.client.HTTPException):
        return fail(output, 502, 'upstream_unavailable')
    with response:
        content_type = response.headers.get('Content-Type', 'application/octet-stream')
        if any(ord(c) < 32 or ord(c) > 126 for c in content_type):
            content_type = 'application/octet-stream'
        header(output, response.status, content_type)
        total = 0
        while True:
            chunk = response.read1(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > 128 * 1024 * 1024:
                raise ValueError('response_limit')
            output.write(chunk)
            output.flush()


if __name__ == '__main__':
    try:
        run(sys.stdin.buffer, sys.stdout.buffer)
    except Exception:
        # Never print upstream exceptions, request bodies or credentials.
        sys.exit(1)
