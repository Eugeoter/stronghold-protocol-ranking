"""Rebuild the local PRTS catalog and image cache.

Usage: python scripts/sync_catalog.py [--refresh] [--no-images]
Requires beautifulsoup4. Uses the public MediaWiki API, not page screenshots.
The checked-in catalog/assets work completely offline after initial download.
"""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

from bs4 import BeautifulSoup

ROOT = Path(__import__('os').path.abspath(__file__)).parents[1]
CACHE = ROOT / 'data' / 'source-cache'
ASSETS = ROOT / 'static' / 'assets'
SEASONS = [
    {'id': 'covenant-2025', 'name': '盟约 · 上半', 'date': '2025.11.14—2025.12.12',
     'description': '盟约首期；六种核心盟约、十二种附加盟约，预设干员分为 I—VI 阶。',
     'page': '卫戍协议：盟约'},
    {'id': 'covenant-2026', 'name': '盟约 · 下半', 'date': '2026.03.14—2026.04.25',
     'description': '盟约下半期；更新参战阵容、盟约效果、敌方势力与机变阶段。',
     'page': '卫戍协议：盟约 下半'},
]
ROMAN = {'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V', 'Ⅵ': 'VI'}
EXPECTED = {'covenant-2025': {'operator': 96, 'pact': 18, 'boss': 6, 'strategy': 30},
            'covenant-2026': {'operator': 115, 'pact': 23, 'boss': 7, 'strategy': 40}}
GAME_BASE = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/'
SOURCE_MANIFEST = {}


def game_file(relative, refresh=False):
    target = CACHE / Path(relative).name
    SOURCE_MANIFEST[target.name] = GAME_BASE + relative
    if refresh or not target.exists():
        raw = fetch(GAME_BASE + relative)
        json.loads(raw)
        target.write_bytes(raw)
    return json.loads(target.read_text(encoding='utf-8'))


def supplement_enemies(items, jobs, refresh=False):
    """Cross-check all battle waves and recursively reachable enemy summons against client data."""
    activity = game_file('excel/activity_table.json', refresh)
    handbook = game_file('excel/enemy_handbook_table.json', refresh)['enemyData']
    enemy_db = {e['Key']: e['Value'] for e in game_file('levels/enemydata/enemy_database.json', refresh)['enemies']}
    ac = activity['autoChessData']
    sources = []
    for sid, aid in [('covenant-2025', 'act1autochess'), ('covenant-2026', 'act2autochess')]:
        act = activity['activity']['AUTOCHESS_SEASON'][aid]
        level_ids = {e['levelId'] for rounds in act['battleDataDict'].values() for entries in rounds.values() for e in entries}
        def level_path(level_id):
            return 'levels/' + level_id.lower() + '.json'
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            levels = list(executor.map(lambda level_id: game_file(level_path(level_id), refresh), sorted(level_ids)))
        keys = set()
        tags_by_key = {}
        def add(k):
            if k in enemy_db:
                keys.add(k)
        for level in levels:
            for wave in level.get('waves', []):
                for fragment in wave.get('fragments', []):
                    for action in fragment.get('actions', []):
                        if action.get('actionType') == 'SPAWN': add(action.get('key'))
            for branch in (level.get('branches') or {}).values():
                for phase in branch.get('phases', []):
                    for action in phase.get('actions', []):
                        if action.get('actionType') == 'SPAWN': add(action.get('key'))
        for type_key, group_keys in act['enemyInfoDict'].items():
            tag = ac['enemyTypeDatas'][type_key]['name'].split('·')[-1]
            for k in group_keys:
                add(k)
                tags_by_key.setdefault(k, set()).add(tag)
        for entry in act['specialEnemyInfoDict'].values():
            for k in entry['attachedNormalEnemyKeys'] + entry['attachedEliteEnemyKeys'] + [entry['specialEnemyKey']]:
                add(k)
        for boss_id in act['bossInfoDict']:
            add(ac['bossInfoDict'][boss_id]['enemyId'])
        for k in re.findall(r'enemy_[A-Za-z0-9_]+', json.dumps(act['effectBuffInfoDataDict'])):
            add(k)
        # Only traverse enemy records reachable from this season, so unrelated game enemies cannot leak in.
        scanned = set()
        while keys - scanned:
            k = sorted(keys - scanned)[0]
            scanned.add(k)
            for child in re.findall(r'enemy_[A-Za-z0-9_]+', json.dumps(enemy_db[k])):
                add(child)
        existing = {i['name']: i for i in items if sid in i['seasons'] and i['kind'] in ('enemy', 'boss')}
        added = []
        for key in sorted(keys):
            record = handbook.get(key)
            name = record.get('name') if record else None
            raw_data = enemy_db[key][0]['enemyData']
            if not name:
                name_field = raw_data.get('name', {})
                name = name_field.get('m_value') if isinstance(name_field, dict) else name_field
            if not name:
                raise RuntimeError('No canonical name for reachable enemy ' + key)
            name = name.strip()
            if name == '“炎佑”':
                continue  # friendly pact summon, not a rankable enemy
            tags = sorted(tags_by_key.get(key, set()))
            motion = raw_data.get('motion', {}).get('m_value')
            if motion == 'FLY': tags += ['空中单位']
            elif motion == 'WALK': tags += ['地面单位']
            if name in existing:
                old = existing[name]
                old['tags'] = list(dict.fromkeys(old['tags'] + tags))
                old.setdefault('gameIds', []).append(key)
                continue
            filename = '头像_敌人_' + name + '.png'
            md5 = hashlib.md5(filename.encode()).hexdigest()
            url = 'https://media.prts.wiki/' + md5[0] + '/' + md5[:2] + '/' + urllib.parse.quote(filename)
            asset = hashlib.sha256(url.encode()).hexdigest()[:20] + '.png'
            jobs[asset] = url
            kind = 'boss' if record and record.get('enemyLevel') == 'BOSS' else 'enemy'
            item = base(name, kind, sid, '/static/assets/' + asset, GAME_BASE + 'excel/activity_table.json')
            description = record.get('description', '') if record else ''
            item.update(tags=tags + (['领袖', '悬赏/策略'] if kind == 'boss' else ['战场/召唤']), description=description or '本期波次或敌人召唤配置中可出现的敌方单位。',
                        entitySource=wiki_url(name), gameIds=[key])
            items.append(item)
            existing[name] = item
            added.append(name)
        sources.append({'season': sid, 'waveTemplates': len(level_ids), 'reachableGameIds': sorted(keys), 'addedNames': added})
        print('Client cross-check:', sid, len(level_ids), 'wave templates;', len(keys), 'enemy ids;', len(added), 'added names', flush=True)
    (ROOT / 'data' / 'enemy-coverage.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding='utf-8')


def fetch(url):
    """Use system curl when available (also respects the OS proxy settings)."""
    try:
        result = subprocess.run(['curl.exe' if __import__('os').name == 'nt' else 'curl',
                                 '--fail', '--silent', '--show-error', '--location',
                                 '--retry', '2', '--max-time', '60', url],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return result.stdout
    except FileNotFoundError:
        request = urllib.request.Request(url, headers={'User-Agent': 'StrongholdRanking/1.0'})
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()


def wiki_url(title):
    return 'https://prts.wiki/w/' + urllib.parse.quote(title.replace(' ', '_'), safe='/')


def page(title, refresh=False):
    file = CACHE / (hashlib.sha256(title.encode()).hexdigest()[:16] + '.json')
    SOURCE_MANIFEST[file.name] = 'https://prts.wiki/api.php?' + urllib.parse.urlencode({'action': 'parse', 'page': title, 'prop': 'text|wikitext', 'format': 'json'})
    if refresh or not file.exists():
        params = urllib.parse.urlencode({'action': 'parse', 'page': title, 'prop': 'text|wikitext', 'format': 'json'})
        raw = fetch('https://prts.wiki/api.php?' + params)
        data = json.loads(raw)
        if 'parse' not in data:
            raise RuntimeError('PRTS parse failed: ' + str(data))
        file.write_bytes(raw)
    return json.loads(file.read_text(encoding='utf-8'))['parse']


def clean(node):
    clone = BeautifulSoup(str(node), 'html.parser')
    for hidden in clone.select('style, script, [style*="display:none"], [style*="display: none"], .mw-editsection'):
        hidden.decompose()
    return re.sub(r'\s+', ' ', clone.get_text(' ', strip=True)).strip()


def trait_description(cell):
    clone = BeautifulSoup(str(cell), 'html.parser')
    category = clone.find('div', style=lambda s: s and 'position:absolute' in s)
    category_name = clean(category) if category else ''
    if category:
        category.decompose()
    arrow = clone.select_one('.mdi-arrow-right')
    if arrow:
        arrow.replace_with('|||ELITE|||')
        pieces = clean(clone).split('|||ELITE|||', 1)
        return category_name + ' 【初始】' + pieces[0].strip() + ' 【精锐】' + pieces[1].strip()
    return category_name + ' ' + clean(clone)


def original_image(img):
    url = img.get('src', '').split('?')[0]
    # MediaWiki thumb URLs encode the original full-resolution image path.
    parts = urllib.parse.urlsplit(url)
    segments = parts.path.split('/')
    if len(segments) > 5 and segments[1] == 'thumb':
        url = urllib.parse.urlunsplit((parts.scheme, parts.netloc, '/' + '/'.join(segments[2:-1]), '', ''))
    return url


def image_ref(img, jobs):
    url = original_image(img)
    if not url:
        return ''
    filename = hashlib.sha256(url.encode()).hexdigest()[:20] + Path(urllib.parse.unquote(urllib.parse.urlsplit(url).path)).suffix
    jobs[filename] = url
    return '/static/assets/' + filename


def base(name, kind, season, image, source, **fields):
    return dict(name=name, kind=kind, seasons=[season], image=image, source=source,
                tier='', mainPact='', subPacts=[], tags=[], description='', **fields)


def direct_rows(table):
    body = table.find('tbody', recursive=False) or table
    return body.find_all('tr', recursive=False)


def parse_strategies(soup, season, source, jobs):
    items, active = [], False
    for node in soup.select('.mw-parser-output > *'):
        heading = node.find('h2') if node.name != 'table' else None
        if heading:
            active = clean(heading) == 'S.W.E.E.P.策略报告'
        if not active or node.name != 'table':
            continue
        rows = direct_rows(node)
        cells = rows[0].find_all('td', recursive=False) if rows else []
        if len(cells) != 3 or len(rows) != 2 or clean(cells[1]) != '发起':
            raise RuntimeError('Unexpected strategy table structure')
        leader = clean(cells[0])
        name = rows[1].get_text(' / ', strip=True)
        content = BeautifulSoup(str(cells[2]), 'html.parser')
        for old in content.select('del'):
            old.decompose()
        life = re.search(r'初始生命值\s*(\d+)', clean(content))
        if not life:
            raise RuntimeError('Missing strategy initial life: ' + name)
        lock = content.select_one('.mdi-lock-open-variant')
        if not lock:
            raise RuntimeError('Missing strategy unlock condition: ' + name)
        unlock_parts = []
        for sibling in lock.next_siblings:
            if getattr(sibling, 'name', '') in ('hr', 'br'):
                break
            unlock_parts.append(clean(sibling))
        unlock = ' '.join(unlock_parts).strip()
        if not unlock:
            raise RuntimeError('Empty strategy unlock condition: ' + name)
        lock.replace_with('|||UNLOCK|||')
        description = clean(content).split('|||UNLOCK|||', 1)[0]
        description = re.sub(r'^初始生命值\s*\d+\s*', '', description)
        item = base(name, 'strategy', season['id'], image_ref(cells[0].find('img'), jobs), source + '#S.W.E.E.P.策略报告')
        item.update(leader=leader, initialLife=int(life.group(1)), unlock=unlock,
                    description=description, tags=['初始解锁' if unlock == '初始解锁' else '需解锁'])
        items.append(item)
    # Count and initial HP cross-check against the independent client table.
    game = game_file('excel/activity_table.json')
    aid = 'act1autochess' if season['id'] == 'covenant-2025' else 'act2autochess'
    client = game['activity']['AUTOCHESS_SEASON'][aid]['bandDataListDict']
    by_leader = {game['autoChessData']['bandDataDict'][key]['bandName']: value for key, value in client.items()}
    if {item['leader'] for item in items} != set(by_leader):
        raise RuntimeError('Strategy leader list differs from client data')
    for item in items:
        entry = by_leader[item['leader']]
        title = re.match(r'【([^】]+)】', entry['bandDesc']).group(1)
        if title not in item['name'] or entry['totalHp'] != item['initialLife']:
            raise RuntimeError('Strategy name/initial life differs from client: ' + item['leader'])
    return items


def parse_season(season, jobs, refresh=False):
    title = season['page'] + '/PRTS盟约记录'
    data = page(title, refresh)
    soup = BeautifulSoup(data['text']['*'], 'html.parser')
    source = wiki_url(title)
    sid = season['id']
    items, pacts, groups = [], [], []
    items += parse_strategies(soup, season, source, jobs)
    # Every top-level pact table has two cells in its first row.
    mode = None
    for node in soup.select('.mw-parser-output > *'):
        heading = node.find(['h2', 'h3']) if node.name != 'table' else None
        if heading:
            label = clean(heading)
            if label == '核心盟约': mode = 'core'
            elif label == '附加盟约': mode = 'extra'
            elif heading.name == 'h2': mode = None
        if node.name != 'table' or mode not in ('core', 'extra'):
            continue
        row = direct_rows(node)[0]
        cells = row.find_all(['td', 'th'], recursive=False)
        if len(cells) != 2 or not cells[0].find('img'):
            continue
        name = clean(cells[0])
        image = image_ref(cells[0].find('img'), jobs)
        description = clean(cells[1])
        item = base(name, 'pact', sid, image, source)
        item.update(description=description, tags=['核心盟约' if mode == 'core' else '附加盟约'], pactType=mode)
        items.append(item)
        pacts.append({'name': name, 'image': image, 'type': mode, 'seasons': [sid]})
        # Rank the genuine activation/advanced effect thresholds separately.
        # "进阶盟约" is a presentation label; the source's terms remain in each description.
        activation = re.search(r'激活所需人数\s*(\d+)', description)
        if activation:
            count = activation.group(1)
            bond = base(name + ' · ' + count + '人激活', 'synergy', sid, image, source)
            bond.update(mainPact=name, tags=['人数激活', item['tags'][0]],
                        description='激活条件：' + count + '名不同盟约干员。' + description,
                        activationCount=int(count), pactType=mode)
            items.append(bond)
        for threshold in re.findall(r'<([^>]+)>', description):
            condition = re.sub(r'\s+', '', threshold)
            if not re.search(r'\d', condition) or not (condition.startswith('在场') or condition.startswith('达到') or condition.startswith('首次达到')):
                continue
            bond = base(name + ' · ' + condition, 'synergy', sid, image, source)
            bond.update(mainPact=name, tags=['进阶条件', item['tags'][0]],
                        description='进阶条件：' + condition + '。' + description, pactType=mode)
            items.append(bond)

    core_names = {p['name'] for p in pacts if p['type'] == 'core'}
    # Nested tier tables are identified from their direct header, excluding prototype substitutes.
    db = soup.find(id='干员数据库').find_next('table')
    for table in db.find_all('table'):
        rows = direct_rows(table)
        if not rows:
            continue
        tier_text = clean(rows[0])
        match = re.match(r'([ⅠⅡⅢⅣⅤⅥ])\s*阶干员', tier_text)
        if not match:
            continue
        tier = ROMAN[match.group(1)]
        for row in rows[2:]:
            cells = row.find_all('td', recursive=False)
            if len(cells) < 3:
                continue
            portrait = cells[0].find('img', id='charicon')
            if portrait is None:
                continue
            link = portrait.find_parent('a')
            name = link['title']
            pact_names = clean(cells[1]).split()
            main = [p for p in pact_names if p in core_names]
            extra = [p for p in pact_names if p not in core_names]
            item = base(name, 'operator', sid, image_ref(portrait, jobs), source)
            occupation = cells[0].find('img', id='typeicon')
            occupation_name = ''
            if occupation and occupation.get('src'):
                occupation_name = urllib.parse.unquote(occupation['src']).split('图标_职业_')[-1].split('.png')[0]
            item.update(tier=tier, mainPact=main[0] if main else '', mainPacts=main,
                        subPacts=extra, tags=[occupation_name] if occupation_name else [],
                        description=trait_description(cells[2]), entitySource=wiki_url(name))
            if name == '盟约·辅助干员':
                item['tags'].append('策略特有')
            if sid == 'covenant-2026' and name in ('地灵', '红豆', '崖心', '协律', '见行者', '巫恋', '瑰盐', '蜜蜡'):
                item['tags'].append('3月27日暂离')
            items.append(item)

    # Boss/hidden-core list, then training enemy groups (all names and classifications from the table).
    boss_table = soup.find(id='领袖').find_next('table')
    for icon in boss_table.select('.enemyicon'):
        link = icon.find('a', title=True)
        img = icon.find('img')
        if link and img:
            item = base(link['title'], 'boss', sid, image_ref(img, jobs), source)
            item.update(tags=['领袖'], description='本期最终领袖或隐秘核心；模拟中的数值与原关卡不同。',
                        entitySource=wiki_url(link['title']))
            items.append(item)
    training = soup.find(id='战术特训敌人').find_next('table')
    for row in direct_rows(training):
        cells = row.find_all('td', recursive=False)
        if len(cells) != 2 or not cells[1].select('.enemyicon'):
            continue
        tag = clean(cells[0])
        icon = cells[0].find('img')
        tip = cells[0].find('span', attrs={'data-append-to': 'body'})
        description = tip.get_text(' ', strip=True) if tip else ''
        if icon:
            groups.append({'name': tag, 'image': image_ref(icon, jobs), 'seasons': [sid], 'description': description})
        for icon in cells[1].select('.enemyicon'):
            link = icon.find('a', title=True)
            img = icon.find('img')
            if link and img:
                item = base(link['title'], 'enemy', sid, image_ref(img, jobs), source)
                item.update(tags=[tag], description=description, entitySource=wiki_url(link['title']))
                items.append(item)
    # Three boss-associated enemies are in the activity's unique enemy overview,
    # but not its training table. "炎佑" is a friendly pact summon and is excluded.
    activity = BeautifulSoup(page(season['page'], refresh)['text']['*'], 'html.parser')
    extra_descriptions = {
        '假想敌：弦': '假想敌：管的关联精英敌人；永久无敌，持续召唤“余音”，在假想敌：管倒下后离场。',
        '“碎铳之簧”': '卫戍协议假想敌：铳的关联敌方单位，收录于活动独特敌人一览表。',
        '“余音”': '假想敌：弦召唤的关联敌人，具有“金黄的悲号”与“暗色的喟叹”形态。',
    }
    extra_found = set()
    for icon in activity.select('.enemyicon'):
        link, img = icon.find('a', title=True), icon.find('img')
        if not link or not img or link['title'] not in extra_descriptions or link['title'] in extra_found:
            continue
        name = link['title']
        extra_found.add(name)
        item = base(name, 'enemy', sid, image_ref(img, jobs), wiki_url(season['page']))
        item.update(tags=['领袖附属'], description=extra_descriptions[name], entitySource=wiki_url(name))
        items.append(item)
    if extra_found != set(extra_descriptions):
        raise RuntimeError('Missing boss-associated enemies in activity overview')
    for kind, expected in EXPECTED[sid].items():
        actual = sum(i['kind'] == kind for i in items)
        if actual != expected:
            raise RuntimeError('%s %s: expected %s, parsed %s; review source before updating expected counts' % (sid, kind, expected, actual))
    return items, pacts, groups


def consolidate(items):
    result = {}
    for item in items:
        signature = item['kind'] + '|' + item['name']
        key = item['kind'] + '-' + hashlib.sha256(signature.encode()).hexdigest()[:12]
        detail = {field: item[field] for field in ('tier', 'mainPact', 'subPacts', 'tags', 'description', 'source', 'image')}
        if 'mainPacts' in item:
            detail['mainPacts'] = item['mainPacts']
        for field in ('gameIds', 'entitySource', 'pactType', 'activationCount', 'leader', 'initialLife', 'unlock'):
            if field in item:
                detail[field] = item[field]
        sid = item['seasons'][0]
        if key in result:
            old = result[key]
            old['seasons'] = sorted(set(old['seasons'] + item['seasons']))
            if sid in old['seasonDetails']:
                previous = old['seasonDetails'][sid]
                if item['kind'] == 'operator' and previous['tier'] != detail['tier']:
                    raise RuntimeError('Same-season operator tier conflict: ' + item['name'])
                previous['tags'] = list(dict.fromkeys(previous['tags'] + detail['tags']))
                if 'gameIds' in detail:
                    previous['gameIds'] = list(dict.fromkeys(previous.get('gameIds', []) + detail['gameIds']))
                if detail['description'] not in previous['description']:
                    previous['description'] += ' ' + detail['description']
            else:
                old['seasonDetails'][sid] = detail
        else:
            item['id'] = key
            item['seasonDetails'] = {sid: detail}
            result[key] = item
    return list(result.values())


def download(job):
    filename, url = job
    target = ASSETS / filename
    if target.exists() and target.stat().st_size > 100:
        return None
    try:
        raw = fetch(url)
        if not raw.startswith((b'\x89PNG', b'\xff\xd8', b'GIF8', b'RIFF')):
            raise RuntimeError('Response is not an image')
        target.write_bytes(raw)
    except Exception as exc:
        return {'file': filename, 'url': url, 'error': str(exc)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true', help='Refresh source API snapshots')
    parser.add_argument('--no-images', action='store_true')
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    jobs, all_items, all_pacts, all_groups = {}, [], [], []
    for season in SEASONS:
        items, pacts, groups = parse_season(season, jobs, args.refresh)
        all_items += items
        all_pacts += pacts
        all_groups += groups
        print(season['id'], {k: sum(i['kind'] == k for i in items) for k in ('operator', 'pact', 'synergy', 'enemy', 'boss', 'strategy')}, flush=True)
    supplement_enemies(all_items, jobs, args.refresh)
    catalog = {
        'seasons': [{k: v for k, v in s.items() if k != 'page'} for s in SEASONS],
        'items': consolidate(all_items),
        'pacts': list({p['name']: dict(p, seasons=sorted({s for q in all_pacts if q['name'] == p['name'] for s in q['seasons']})) for p in all_pacts}.values()),
        'enemyGroups': list({g['name']: dict(g, seasons=sorted({s for q in all_groups if q['name'] == g['name'] for s in q['seasons']})) for g in all_groups}.values()),
        'sources': [{'title': s['page'] + '/PRTS盟约记录', 'url': wiki_url(s['page'] + '/PRTS盟约记录')} for s in SEASONS] +
                   [{'title': s['page'], 'url': wiki_url(s['page'])} for s in SEASONS] +
                   [{'title': '公开客户端活动配置（ArknightsGameData）', 'url': GAME_BASE + 'excel/activity_table.json'},
                    {'title': '公开客户端敌人图鉴（ArknightsGameData）', 'url': GAME_BASE + 'excel/enemy_handbook_table.json'},
                    {'title': '公开客户端战斗敌人及召唤关系（ArknightsGameData）', 'url': GAME_BASE + 'levels/enemydata/enemy_database.json'}] +
                   [{'title': '卫戍协议玩法总览', 'url': wiki_url('卫戍协议')}],
        'updatedAt': datetime.now(timezone(timedelta(hours=8))).isoformat(),
        'notes': ['等阶为活动内综合行动效率评级，并非干员星级。', '主盟约按游戏核心盟约归类；存在双核心盟约的干员保留 mainPacts。',
                  '进阶盟约按盟约的真实激活人数、在场人数或层数门槛拆分，游戏术语为盟约。', 'PRTS干员数据库完整收录（含策略特有辅助干员及其保留的暂离记录）；甄选任意六星干员与原型替补不混入预设阵容。',
                  '敌人按公开客户端活动波次、分组、策略和递归召唤关系补全；战术分组与地面/空中行动方式分别保留。',
                  'BOSS包含最终领袖、隐秘核心及悬赏/策略可出现的图鉴领袖；同名的数值变体共用一张卡片。'],
        'assetCredits': '游戏素材版权属于上海鹰角网络科技有限公司及其关联公司；数据与素材来源 PRTS，供非商业玩家工具使用。',
    }
    (ROOT / 'data' / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    (ROOT / 'data' / 'asset-manifest.json').write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding='utf-8')
    (CACHE / 'manifest.json').write_text(json.dumps(SOURCE_MANIFEST, ensure_ascii=False, indent=2), encoding='utf-8')
    if not args.no_images:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            errors = [e for e in executor.map(download, jobs.items()) if e]
        (ROOT / 'data' / 'asset-errors.json').write_text(json.dumps(errors, ensure_ascii=False, indent=2), encoding='utf-8')
        print('Images:', len(jobs), 'Failures:', len(errors), flush=True)
        if errors:
            raise SystemExit('Some downloads failed; rerun to retry missing images.')
        for filename in jobs:
            target = ASSETS / filename
            if not target.exists() or target.stat().st_size <= 100:
                raise SystemExit('Missing or empty asset: ' + filename)
        referenced = {i['image'].split('/')[-1] for i in catalog['items']} | {p['image'].split('/')[-1] for p in catalog['pacts']}
        if not referenced.issubset(jobs):
            raise SystemExit('Catalog contains image references absent from manifest')


if __name__ == '__main__':
    main()
