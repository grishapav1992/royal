import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location('gateway', Path(__file__).with_name('request.py'))
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class Response(io.BytesIO):
    status = 200
    headers = {'Content-Type': 'text/event-stream'}


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.key = Path(self.directory.name) / 'key'
        self.key.write_text('test-provider-secret')
        self.key.chmod(0o600)
        self.calls = []
        self.response = Response(b'data: test\n\n')
        self.error = None

    def open(self, request, timeout):
        self.calls.append(request)
        if self.error:
            raise self.error
        return self.response

    def call(self, method='GET', path='/v1/models', body=b'', content_type='application/json', length=None):
        source = io.BytesIO(json.dumps({'method': method, 'path': path, 'length': len(body) if length is None else length,
                                       'contentType': content_type}).encode() + b'\n' + body)
        output = io.BytesIO()
        gateway.run(source, output, str(self.key), self)
        meta, body = output.getvalue().split(b'\n', 1)
        return json.loads(meta), body

    def test_server_injects_key_only_into_canonical_upstream(self):
        meta, body = self.call()
        self.assertEqual(meta['status'], 200)
        self.assertEqual(body, b'data: test\n\n')
        self.assertEqual(self.calls[0].full_url, 'https://api.a6api.com/v1/models')
        self.assertEqual(self.calls[0].get_header('Authorization'), 'Bearer test-provider-secret')
        self.assertNotIn(b'test-provider-secret', body)

    def test_rejects_arbitrary_routes_and_traversal(self):
        for path in ('https://evil.example', '/v1/models?x=y', '/v1/../billing', '/api/token'):
            self.assertEqual(self.call(path=path)[0]['status'], 404)
        self.assertEqual(self.calls, [])

    def test_binary_multipart_is_preserved(self):
        body = b'\x00\xff\x80'
        self.call('POST', '/v1/images/edits', body, 'multipart/form-data; boundary=example')
        self.assertEqual(self.calls[0].data, body)

    def test_rejects_bad_framing_and_header_injection(self):
        for kwargs in ({'length': 4}, {'length': True}, {'length': -1}, {'length': gateway.MAX_BODY + 1},
                       {'content_type': 'text/plain\r\nx-secret: test'}):
            self.assertEqual(self.call(**kwargs)[0]['status'], 400)
        self.assertEqual(self.calls, [])

    def test_publicly_readable_key_or_symlink_fails_closed(self):
        self.key.chmod(0o644)
        self.assertEqual(self.call()[0]['status'], 503)
        self.key.unlink()
        self.key.symlink_to('/does/not/exist')
        self.assertEqual(self.call()[0]['status'], 503)
        self.assertEqual(self.calls, [])

    def test_redirects_rejected_without_following_credentials(self):
        self.error = urllib.error.HTTPError('https://api.a6api.com/v1/models', 302, 'redirect', {}, io.BytesIO())
        meta, body = self.call()
        self.assertEqual(meta['status'], 502)
        self.assertIn(b'upstream_redirect_rejected', body)
        self.assertIsNone(gateway.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example'))

    def test_upstream_errors_preserve_status_but_network_errors_are_generic(self):
        self.error = urllib.error.HTTPError('https://api.a6api.com/v1/models', 429, 'quota', {'Content-Type': 'application/json'}, io.BytesIO(b'{"error":"quota"}'))
        self.assertEqual(self.call()[0]['status'], 429)
        self.error = urllib.error.URLError('private test-provider-secret')
        meta, body = self.call()
        self.assertEqual(meta['status'], 502)
        self.assertNotIn(b'test-provider-secret', body)


if __name__ == '__main__':
    unittest.main()
