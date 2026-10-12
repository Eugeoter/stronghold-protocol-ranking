import json
import os
import unittest
from pathlib import Path

from PIL import Image

from app import app

ROOT = Path(os.path.abspath(__file__)).parents[1]


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with (ROOT / 'data' / 'catalog.json').open(encoding='utf-8') as handle:
            cls.catalog = json.load(handle)

    def test_real_catalog_roundtrips_every_type_and_season(self):
        client = app.test_client()
        self.assertEqual(client.get('/').status_code, 200)
        self.assertEqual(client.get('/api/catalog').status_code, 200)
        for season in self.catalog['seasons']:
            for kind in ['operator', 'pact', 'synergy', 'strategy', 'enemy', 'boss']:
                ids = [i['id'] for i in self.catalog['items'] if i['kind'] == kind and season['id'] in i['seasons']]
                self.assertTrue(ids, (season['id'], kind))
                board = {'version': 2, 'title': '全收录核验', 'kind': kind, 'season': season['id'], 'rows': [ids] + [[] for _ in range(8)]}
                shared = client.post('/api/share', json=board)
                self.assertEqual(shared.status_code, 200, shared.json)
                imported = client.post('/api/import', json={'code': shared.json['code']})
                self.assertEqual(imported.json['board'], board)

    def test_local_assets_are_valid_images(self):
        paths = {i['image'] for i in self.catalog['items']} | {p['image'] for p in self.catalog['pacts']} | {g['image'] for g in self.catalog.get('enemyGroups', [])}
        paths.update(detail['image'] for item in self.catalog['items'] for detail in item.get('seasonDetails', {}).values() if detail.get('image'))
        for path in paths:
            self.assertTrue(path.startswith('/static/assets/'))
            absolute = ROOT / path.lstrip('/')
            self.assertTrue(absolute.is_file(), path)
            with absolute.open('rb') as handle:
                with Image.open(handle) as image:
                    self.assertGreater(image.width, 16, path)
                    self.assertGreater(image.height, 16, path)
                    image.verify()

    def test_ids_seasons_tiers_and_pact_memberships(self):
        items = self.catalog['items']
        self.assertEqual(len(items), len({i['id'] for i in items}))
        seasons = {s['id'] for s in self.catalog['seasons']}
        pacts = {p['name'] for p in self.catalog['pacts']}
        for item in items:
            self.assertTrue(item['name'])
            self.assertTrue(set(item['seasons']).issubset(seasons))
            if item['kind'] == 'operator':
                for season in item['seasons']:
                    detail = dict(item, **item.get('seasonDetails', {}).get(season, {}))
                    self.assertIn(detail['tier'], ['I', 'II', 'III', 'IV', 'V', 'VI'])
                    self.assertTrue(set(detail.get('mainPacts', [detail['mainPact']])).issubset(pacts))
                    self.assertTrue(set(detail['subPacts']).issubset(pacts))
        expected = {'covenant-2025': 96, 'covenant-2026': 115}
        for season, count in expected.items():
            self.assertEqual(sum(i['kind'] == 'operator' and season in i['seasons'] for i in items), count)

    def test_starting_strategy_rosters_and_named_examples(self):
        items = [item for item in self.catalog['items'] if item['kind'] == 'strategy']
        for season, count in [('covenant-2025', 30), ('covenant-2026', 40)]:
            self.assertEqual(sum(season in item['seasons'] for item in items), count)
        expected = {'变形同构': '变形者集群', '优等生': 'Pith', '博学多通': '佩佩'}
        for name, leader in expected.items():
            item = next(item for item in items if item['name'] == name)
            self.assertEqual(item['leader'].strip('“”'), leader)
            for season in item['seasons']:
                detail = item['seasonDetails'][season]
                self.assertTrue(detail['description'])
                self.assertTrue(detail['unlock'])
                self.assertGreater(detail['initialLife'], 0)


if __name__ == '__main__':
    unittest.main()
