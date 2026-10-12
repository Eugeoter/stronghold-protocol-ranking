"""Build the GitHub Pages edition without including the Python runtime."""
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(os.path.abspath(__file__)).parent.parent
sys.path.insert(0, str(ROOT))
from app import app, catalog  # noqa: E402
from flask import render_template


def build(destination=None):
    destination = Path(destination or ROOT / 'dist')
    destination.mkdir(parents=True, exist_ok=True)
    with app.app_context():
        html = render_template('index.html', deployment_mode='static')
    html = html.replace('"/static/', '"static/').replace('href="/"', 'href="./"')
    (destination / 'index.html').write_text(html, encoding='utf-8')
    (destination / '.nojekyll').write_text('', encoding='utf-8')
    shutil.copytree(ROOT / 'static', destination / 'static', dirs_exist_ok=True)
    (destination / 'data').mkdir(exist_ok=True)
    shutil.copyfile(ROOT / 'data' / 'catalog.json', destination / 'data' / 'catalog.json')
    # Fail the build before publishing if a local asset is absent.
    data = catalog()
    for entry in data['items'] + data['pacts'] + data.get('enemyGroups', []):
        for detail in [entry] + list(entry.get('seasonDetails', {}).values()):
            image = detail.get('image', '')
            if image.startswith('/static/') and not (destination / image.lstrip('/')).is_file():
                raise RuntimeError('Missing image: ' + image)
    print('Static edition ready: {} items'.format(len(data['items'])))
    return destination


if __name__ == '__main__':
    build()
