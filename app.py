"""Local Flask server for the Stronghold Protocol tier list."""
import base64
import json
import os
import zlib
from pathlib import Path
from functools import lru_cache

from flask import Flask, jsonify, render_template, request

ROOT = Path(os.path.abspath(__file__)).parent
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 512 * 1024
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.config['JSON_AS_ASCII'] = False
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 3600
if hasattr(app, 'json'):
    app.json.ensure_ascii = False
KINDS = {'operator', 'pact', 'synergy', 'strategy', 'enemy', 'boss'}
MAX_DECODED = 128 * 1024


def catalog():
    path = ROOT / 'data' / 'catalog.json'
    metadata = path.stat()
    return _cached_catalog(metadata.st_mtime_ns, metadata.st_size)


@lru_cache(maxsize=1)
def _cached_catalog(_modified, _size):
    with (ROOT / 'data' / 'catalog.json').open(encoding='utf-8') as handle:
        return json.load(handle)


def validate_board(value):
    if not isinstance(value, dict) or type(value.get('version')) is not int or value.get('version') not in (1, 2):
        raise ValueError('不支持的排名码版本')
    title = value.get('title')
    if not isinstance(title, str) or not title.strip() or len(title) > 80:
        raise ValueError('榜单名称需要 1–80 个字符')
    data = catalog()
    kind, season = value.get('kind'), value.get('season')
    if not isinstance(kind, str) or not isinstance(season, str) or kind not in KINDS or season not in {s['id'] for s in data['seasons']}:
        raise ValueError('排名类型或活动期数无效')
    rows = value.get('rows')
    expected_rows = 5 if value['version'] == 1 else 9
    if not isinstance(rows, list) or len(rows) != expected_rows:
        raise ValueError('榜单必须包含五个主档位和四个中间档位')
    if value['version'] == 1:
        rows = [rows[0], [], rows[1], [], rows[2], [], rows[3], [], rows[4]]
    available = {i['id'] for i in data['items'] if i['kind'] == kind and season in i['seasons']}
    seen = set()
    for row in rows:
        if not isinstance(row, list) or len(row) > 2000:
            raise ValueError('榜单内容无效')
        for identifier in row:
            if not isinstance(identifier, str) or identifier not in available:
                raise ValueError('排名码包含当前期数不存在的条目，请更新资料后重试')
            if identifier in seen:
                raise ValueError('榜单包含重复条目')
            seen.add(identifier)
    return {'version': 2, 'title': title.strip(), 'kind': kind, 'season': season, 'rows': rows}


def encode_board(board):
    raw = json.dumps(validate_board(board), ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return 'SP2.' + base64.urlsafe_b64encode(zlib.compress(raw, 9)).decode('ascii').rstrip('=')


def decode_board(code):
    if not isinstance(code, str) or len(code) > 200000 or not code.startswith(('SP1.', 'SP2.')):
        raise ValueError('排名码格式错误，应以 SP1. 或 SP2. 开头')
    try:
        encoded = code[4:]
        compressed = base64.b64decode(encoded + '=' * (-len(encoded) % 4), altchars=b'-_', validate=True)
        stream = zlib.decompressobj()
        raw = stream.decompress(compressed, MAX_DECODED + 1)
        if len(raw) > MAX_DECODED or stream.unconsumed_tail or stream.unused_data or not stream.eof:
            raise ValueError('排名码内容过大或不完整')
        value = json.loads(raw.decode('utf-8'))
        if not isinstance(value, dict) or value.get('version') != int(code[2]):
            raise ValueError('排名码前缀与版本不一致')
        return validate_board(value)
    except (zlib.error, UnicodeError, json.JSONDecodeError, base64.binascii.Error):
        raise ValueError('排名码损坏，无法读取')


@app.get('/')
def index():
    return render_template('index.html')


@app.get('/api/catalog')
def get_catalog():
    return jsonify(catalog())


@app.get('/healthz')
def health():
    try:
        data = catalog()
        if not data.get('items') or not data.get('seasons'):
            return jsonify(status='unavailable'), 503
        return jsonify(status='ok', items=len(data['items']))
    except (OSError, ValueError):
        return jsonify(status='unavailable'), 503


@app.post('/api/share')
def share():
    try:
        board = validate_board(request.get_json(silent=True))
        return jsonify(code=encode_board(board), board=board)
    except ValueError as error:
        return jsonify(error=str(error)), 400


@app.post('/api/import')
def import_board():
    try:
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise ValueError('请求内容无效')
        return jsonify(board=decode_board(body.get('code')))
    except ValueError as error:
        return jsonify(error=str(error)), 400


@app.errorhandler(413)
def too_large(_error):
    return jsonify(error='请求内容过大'), 413


if __name__ == '__main__':
    app.run(host=os.environ.get('HOST', '127.0.0.1'), port=int(os.environ.get('PORT', '5000')), debug=False)
