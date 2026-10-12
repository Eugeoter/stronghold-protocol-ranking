import base64
import copy
import json
import unittest
import zlib
from unittest.mock import patch

from app import app, decode_board, encode_board

CATALOG = {'seasons': [{'id': '2026'}], 'items': [
    {'id': 'a', 'kind': 'operator', 'seasons': ['2026']},
    {'id': 'b', 'kind': 'operator', 'seasons': ['2026']},
    {'id': 'enemy', 'kind': 'enemy', 'seasons': ['2026']},
]}
BOARD = {'version': 2, 'title': '博士的测试榜单', 'kind': 'operator', 'season': '2026', 'rows': [['b', 'a']] + [[] for _ in range(8)]}


class ShareTests(unittest.TestCase):
    def setUp(self):
        self.mock = patch('app.catalog', return_value=CATALOG)
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.client = app.test_client()

    def test_roundtrip_preserves_unicode_and_order(self):
        self.assertEqual(decode_board(encode_board(BOARD)), BOARD)
        exported = self.client.post('/api/share', json=BOARD)
        self.assertEqual(exported.status_code, 200)
        restored = self.client.post('/api/import', json={'code': exported.json['code']})
        self.assertEqual(restored.json['board'], BOARD)

    def test_duplicate_and_foreign_ids_rejected(self):
        for rows in [[['a'], ['a']] + [[] for _ in range(7)], [['enemy']] + [[] for _ in range(8)], [['missing']] + [[] for _ in range(8)]]:
            board = copy.deepcopy(BOARD)
            board['rows'] = rows
            self.assertEqual(self.client.post('/api/share', json=board).status_code, 400)

    def test_invalid_requests_do_not_crash(self):
        for body in [None, [], {}, {'version': True, 'title': 'x', 'kind': 'operator', 'season': '2026', 'rows': []}, {'version': 2, 'title': 'x', 'kind': [], 'season': [], 'rows': []}]:
            self.assertEqual(self.client.post('/api/share', json=body).status_code, 400)
        for code in ['', 'bad', 'SP1.!', 'SP2.!', 'SP1.eA', None, [], 'SP1.', 'SP3.abc']:
            self.assertEqual(self.client.post('/api/import', json={'code': code}).status_code, 400)

    def test_decompression_limit(self):
        encoded = base64.urlsafe_b64encode(zlib.compress(b'x' * 200000)).decode().rstrip('=')
        self.assertEqual(self.client.post('/api/import', json={'code': 'SP2.' + encoded}).status_code, 400)

    def test_trailing_compressed_data_rejected(self):
        raw = json.dumps(BOARD).encode()
        encoded = base64.urlsafe_b64encode(zlib.compress(raw) + b'extra').decode().rstrip('=')
        self.assertEqual(self.client.post('/api/import', json={'code': 'SP2.' + encoded}).status_code, 400)

    def test_empty_board_and_title_limits(self):
        board = copy.deepcopy(BOARD)
        board['rows'] = [[] for _ in range(9)]
        self.assertEqual(decode_board(encode_board(board)), board)
        for title in ['', ' ' * 4, '字' * 81, 1]:
            board['title'] = title
            self.assertEqual(self.client.post('/api/share', json=board).status_code, 400)

    def test_between_tiers_preserved(self):
        board = copy.deepcopy(BOARD)
        board['rows'] = [[], ['a'], [], [], [], [], [], ['b'], []]
        code = encode_board(board)
        self.assertTrue(code.startswith('SP2.'))
        self.assertEqual(decode_board(code), board)

    def test_old_v1_code_migrates_to_main_tiers(self):
        legacy = dict(BOARD, version=1, rows=[['b'], [], ['a'], [], []])
        raw = json.dumps(legacy, ensure_ascii=False).encode('utf-8')
        code = 'SP1.' + base64.urlsafe_b64encode(zlib.compress(raw)).decode().rstrip('=')
        result = self.client.post('/api/import', json={'code': code})
        self.assertEqual(result.status_code, 200)
        expected = dict(legacy, version=2, rows=[['b'], [], [], [], ['a'], [], [], [], []])
        self.assertEqual(result.json['board'], expected)

    def test_code_prefix_and_body_version_must_match(self):
        self.assertEqual(self.client.post('/api/import', json={'code': encode_board(BOARD).replace('SP2.', 'SP1.', 1)}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
