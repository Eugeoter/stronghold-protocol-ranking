"""Fetch genuine official/PRTS branding, without recreating logos."""
import json
from pathlib import Path
from bs4 import BeautifulSoup
from sync_catalog import ROOT, CACHE, fetch, page, original_image


def main():
    folder = ROOT / 'static' / 'branding'
    folder.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    homepage = CACHE / 'official-home.html'
    if not homepage.exists():
        homepage.write_bytes(fetch('https://ak.hypergryph.com/'))
    html = BeautifulSoup(homepage.read_text(encoding='utf-8'), 'html.parser')
    path = html.find('path', id='svg_def-logo_rhodes_island')
    use = html.find('use', attrs={'xlink:href': '#svg_def-logo_rhodes_island'})
    if not path or not use:
        raise RuntimeError('Official inline Rhodes Island logo not found')
    # Copy the official vector path verbatim into a standalone SVG container.
    viewbox = use.parent.get('viewbox') or use.parent.get('viewBox')
    if not viewbox:
        raise RuntimeError('Official logo viewBox missing')
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewbox + '" fill="white" color="white">' + str(path) + '</svg>'
    (folder / 'rhodes-island-official.svg').write_text(svg, encoding='utf-8')
    manifest = [{'name': '罗德岛官方标志（原始矢量路径）', 'file': '/static/branding/rhodes-island-official.svg',
                 'source': 'https://ak.hypergryph.com/', 'extraction': 'Inline path #svg_def-logo_rhodes_island, original path and viewBox preserved; white fill for dark UI.'}]
    rhodes = html.find('img', alt='RHODES ISLAND')
    if not rhodes or not rhodes.get('src'):
        raise RuntimeError('Official Rhodes Island PNG missing')
    jobs = [('rhodes-island-official.png', rhodes['src'], '罗德岛官方 PNG', 'https://ak.hypergryph.com/')]
    wiki = BeautifulSoup(page('卫戍协议：盟约')['text']['*'], 'html.parser')
    icons = wiki.find_all('img')[:3]
    jobs += [('stronghold-alliance.png', original_image(icons[1]), '卫戍协议：盟约活动标志', 'https://prts.wiki/w/卫戍协议：盟约'),
             ('stronghold-alliance-phase2.png', original_image(icons[2]), '卫戍协议：盟约下半活动标志', 'https://prts.wiki/w/卫戍协议：盟约_下半')]
    for filename, url, name, source in jobs:
        raw = fetch(url)
        if not raw.startswith(b'\x89PNG'):
            raise RuntimeError('Branding download is not PNG: ' + url)
        (folder / filename).write_bytes(raw)
        manifest.append({'name': name, 'file': '/static/branding/' + filename, 'source': source, 'imageSource': url})
    (ROOT / 'data' / 'branding-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print('Genuine branding files:', len(manifest))


if __name__ == '__main__':
    main()
