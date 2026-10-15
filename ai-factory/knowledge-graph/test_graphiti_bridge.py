"""Tests exercise the real embedded graph, not a replacement graph mock."""
import asyncio
from copy import deepcopy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import graphiti_bridge as bridge


def sample_snapshot():
    generated = '2026-10-10T02:00:00.000Z'
    evidence = [dict(path='deployment/finance/STATUS.md', sha256='a' * 64)]
    nodes = [dict(id='service:finance-gateway', name='finance-gateway', entity_type='service',
                  summary='Внутренний интеграционный шлюз финансового ядра.',
                  status='deployed', environment='production', evidence=evidence),
             dict(id='service:finance-api', name='finance-api', entity_type='service',
                  summary='Два экземпляра серверного API с общей PostgreSQL.',
                  status='deployed', environment='production', evidence=evidence)]
    edges = [dict(id='relation:gateway-routes-api', source=nodes[0]['id'], target=nodes[1]['id'],
                  predicate='routes_to', text='finance-gateway распределяет запросы на finance-api.',
                  status='deployed', environment='production', evidence=evidence)]
    events = []
    for kind, records in [('entity', nodes), ('relation', edges)]:
        for record in records:
            payload = dict(record_id=record['id'], parent=None, deleted=False,
                           record=deepcopy(dict(kind=kind, **record)), origin='curated', created_at=generated)
            event_id = hashlib.sha256(bridge.canonical(payload).encode()).hexdigest()
            events.append(dict(id=event_id, **payload))
            record['event_id'] = event_id
    snapshot = dict(schema_version=1, generated_at=generated, nodes=nodes, edges=edges,
                    conflicts=[], events=events)
    return checksum(snapshot)


def checksum(snapshot):
    payload = {key: snapshot[key] for key in ('schema_version', 'nodes', 'edges', 'conflicts')}
    payload['event_ids'] = [event['id'] for event in snapshot['events']]
    snapshot['hash'] = hashlib.sha256(bridge.canonical(payload).encode()).hexdigest()
    return snapshot


def append_version(snapshot, record_id, *, parent=None, text=None, summary=None, deleted=False,
                   created_at='2026-10-10T02:01:00.000Z', project=True):
    original = next(event for event in snapshot['events'] if event['record_id'] == record_id)
    record = deepcopy(original['record']) if not deleted else None
    if text is not None:
        record['text'] = text
    if summary is not None:
        record['summary'] = summary
    payload = dict(record_id=record_id, parent=parent or original['id'], deleted=deleted,
                   record=record, origin='local', created_at=created_at)
    event = dict(id=hashlib.sha256(bridge.canonical(payload).encode()).hexdigest(), **payload)
    snapshot['events'].append(event)
    if project:
        for field in ('nodes', 'edges'):
            snapshot[field] = [item for item in snapshot[field] if item['id'] != record_id]
        if not deleted:
            kind, materialized = record['kind'], {key: value for key, value in record.items() if key != 'kind'}
            snapshot['nodes' if kind == 'entity' else 'edges'].append(dict(materialized, event_id=event['id'], created_at=created_at))
    return event


class ValidationTest(unittest.TestCase):
    def test_symlink_parent_is_rejected_before_database_or_lock_creation(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            target = directory / 'target'
            target.mkdir()
            linked = directory / 'linked'
            linked.symlink_to(target, target_is_directory=True)
            with patch.object(bridge, 'AsyncFalkorDB', side_effect=AssertionError('database opened')):
                with self.assertRaisesRegex(bridge.ProjectionError, 'symbolic links'):
                    bridge.Bridge(linked / 'new' / 'knowledge.rdb')
            self.assertEqual(list(target.iterdir()), [])

    def test_checksum_corruption_and_dangling_entity_are_rejected(self):
        snapshot = sample_snapshot()
        snapshot['nodes'][0]['name'] = 'tampered'
        with self.assertRaisesRegex(bridge.ProjectionError, 'checksum'):
            bridge.validate_snapshot(snapshot)
        snapshot = sample_snapshot()
        snapshot['edges'][0]['target'] = 'service:absent'
        checksum(snapshot)
        with self.assertRaisesRegex(bridge.ProjectionError, 'missing entity'):
            bridge.validate_snapshot(snapshot)

    def test_forbidden_evidence_and_source_without_proof_are_rejected(self):
        snapshot = sample_snapshot()
        snapshot['nodes'][0]['evidence'][0]['path'] = '.env'
        checksum(snapshot)
        with self.assertRaisesRegex(bridge.ProjectionError, 'Forbidden'):
            bridge.validate_snapshot(snapshot)
        snapshot = sample_snapshot()
        snapshot['nodes'][0]['event_id'] = 'f' * 64
        checksum(snapshot)
        with self.assertRaisesRegex(bridge.ProjectionError, 'source event'):
            bridge.validate_snapshot(snapshot)

    def test_explicit_multi_parent_resolution_is_accepted(self):
        snapshot = sample_snapshot()
        root = snapshot['events'][0]
        left = append_version(snapshot, root['record_id'], summary='Left branch', project=False)
        right = append_version(snapshot, root['record_id'], summary='Right branch', project=False)
        append_version(snapshot, root['record_id'], parent=[left['id'], right['id']], summary='Resolved',
                       created_at='2026-10-10T02:02:00.000Z')
        self.assertEqual(bridge.validate_snapshot(checksum(snapshot))['hash'], snapshot['hash'])

    def test_event_contents_cannot_be_changed_without_changing_identity(self):
        snapshot = sample_snapshot()
        snapshot['events'][0]['record']['summary'] += ' Altered evidence.'
        with self.assertRaisesRegex(bridge.ProjectionError, 'Event checksum'):
            bridge.validate_snapshot(snapshot)


class RuntimeTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name).resolve() / 'knowledge.rdb'
        self.runtime = bridge.Bridge(self.path)
        await self.runtime.initialize()

    async def asyncTearDown(self):
        await self.runtime.close()
        self.directory.cleanup()

    async def test_real_ingestion_search_and_persistence_without_provider_calls(self):
        snapshot = sample_snapshot()
        with patch('graphiti_core.graphiti.OpenAIClient', side_effect=AssertionError('paid LLM created')), \
             patch('graphiti_core.graphiti.OpenAIEmbedder', side_effect=AssertionError('paid embedder created')), \
             patch('graphiti_core.graphiti.OpenAIRerankerClient', side_effect=AssertionError('paid reranker created')):
            status = await self.runtime.project(snapshot)
            self.assertEqual(status['hash'], snapshot['hash'])
            self.assertEqual(status['counts'], dict(nodes=2, edges=1, episodes=3, historical_edges=0))
            result = await self.runtime.search('finance gateway')
            self.assertIn('relation:gateway-routes-api', [edge['id'] for edge in result['edges']])
            self.assertTrue((await self.runtime.search('шлюз'))['nodes'])
            before = self.runtime.active['graph_name']
            await self.runtime.project(snapshot)
            self.assertEqual(self.runtime.active['graph_name'], before)
        await self.runtime.close()
        self.runtime = bridge.Bridge(self.path)
        await self.runtime.initialize()
        self.assertEqual((await self.runtime.status())['hash'], snapshot['hash'])
        self.assertTrue((await self.runtime.search('finance'))['nodes'])

    async def test_failed_staging_keeps_the_current_graph(self):
        original = sample_snapshot()
        await self.runtime.project(original)
        replacement = deepcopy(original)
        append_version(replacement, replacement['nodes'][0]['id'], summary='New description.')
        checksum(replacement)
        with patch.object(bridge.EntityEdge, 'save', side_effect=RuntimeError('injected write failure')):
            with self.assertRaisesRegex(RuntimeError, 'injected'):
                await self.runtime.project(replacement)
        self.assertEqual((await self.runtime.status())['hash'], original['hash'])
        self.assertTrue((await self.runtime.search('finance'))['edges'])
        graphs = await self.runtime.client.list_graphs()
        self.assertEqual(len([name for name in graphs if name.startswith(bridge.GRAPH_PREFIX)]), 1)

    async def test_providers_are_explicitly_disabled(self):
        await self.runtime.project(sample_snapshot())
        with self.assertRaises(bridge.ProviderDisabledError):
            await self.runtime.graphiti.llm_client.generate_response([])
        with self.assertRaises(bridge.ProviderDisabledError):
            await self.runtime.graphiti.embedder.create('query')
        with self.assertRaises(bridge.ProviderDisabledError):
            await self.runtime.graphiti.cross_encoder.rank('query', ['text'])
        with self.assertRaisesRegex(bridge.ProjectionError, 'already open'):
            bridge.Bridge(self.path)

    async def test_relation_versions_merge_and_tombstone_do_not_leak_into_current_search(self):
        snapshot = sample_snapshot()
        relation_id = snapshot['edges'][0]['id']
        left = append_version(snapshot, relation_id, text='finance left-obsolete branch', project=False)
        right = append_version(snapshot, relation_id, text='finance right-obsolete branch', project=False)
        resolved = append_version(snapshot, relation_id, parent=[left['id'], right['id']],
            text='finance resolved-current gateway', created_at='2026-10-10T02:02:00.000Z')
        status = await self.runtime.project(checksum(snapshot))
        self.assertEqual(status['counts'], dict(nodes=2, edges=1, episodes=6, historical_edges=3))
        rows, _, _ = await self.runtime.graphiti.driver.execute_query(
            'MATCH ()-[e:RELATES_TO]->() WHERE e.event_id IN $events RETURN e.event_id AS event_id, e.invalid_at AS invalid_at',
            events=[left['id'], right['id']])
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row['invalid_at'] is not None for row in rows))
        self.assertEqual([edge['text'] for edge in (await self.runtime.search('finance'))['edges']],
                         ['finance resolved-current gateway'])
        append_version(snapshot, relation_id, parent=resolved['id'], deleted=True, created_at='2026-10-10T02:03:00.000Z')
        status = await self.runtime.project(checksum(snapshot))
        self.assertEqual(status['counts']['edges'], 0)
        self.assertEqual(status['counts']['historical_edges'], 4)
        self.assertFalse((await self.runtime.search('finance'))['edges'])


if __name__ == '__main__':
    unittest.main()
