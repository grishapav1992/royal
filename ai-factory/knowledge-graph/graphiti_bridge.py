#!/usr/bin/env python3
"""Private Graphiti projection of the verified Royal knowledge journal."""
from __future__ import annotations

import argparse
import asyncio
import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import signal
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from importlib.metadata import version
from urllib.parse import parse_qs, urlsplit
from uuid import NAMESPACE_URL, uuid4, uuid5

# The service has no provider keys. Also prevent the upstream import from reading
# an unrelated working-directory .env or transmitting optional telemetry.
os.environ['GRAPHITI_TELEMETRY_ENABLED'] = 'false'
os.environ['PYTHON_DOTENV_DISABLED'] = '1'

import psutil
from graphiti_core import Graphiti
from graphiti_core.cross_encoder.client import CrossEncoderClient
from graphiti_core.driver.falkordb_driver import FalkorDriver
from graphiti_core.edges import EntityEdge, EpisodicEdge
from graphiti_core.embedder.client import EmbedderClient
from graphiti_core.llm_client.client import LLMClient
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.nodes import EntityNode, EpisodeType, EpisodicNode
from graphiti_core.search.search_config import (
    EdgeReranker, EdgeSearchConfig, EdgeSearchMethod,
    NodeReranker, NodeSearchConfig, NodeSearchMethod, SearchConfig,
)
from graphiti_core.search.search_filters import ComparisonOperator, DateFilter, SearchFilters
from redislite.async_falkordb_client import AsyncFalkorDB

MAX_BYTES = 16 * 1024 * 1024
MAX_RECORDS = 20_000
SHA256 = re.compile(r'^[0-9a-f]{64}$')
IDENTIFIER = re.compile(r'^[A-Za-z0-9_.:/-]{1,256}$')
GRAPH_PREFIX = 'royal_knowledge_'


class ProjectionError(ValueError):
    pass


class ProviderDisabledError(RuntimeError):
    pass


class DisabledLLM(LLMClient):
    def __init__(self):
        super().__init__(LLMConfig(model='disabled', small_model='disabled'), cache=False)

    async def _generate_response(self, *args, **kwargs):
        raise ProviderDisabledError('LLM extraction is disabled in the structured graph service')

    async def generate_response(self, *args, **kwargs):
        raise ProviderDisabledError('LLM extraction is disabled in the structured graph service')


class DisabledEmbedder(EmbedderClient):
    async def create(self, *args, **kwargs):
        raise ProviderDisabledError('Semantic embeddings are disabled in the structured graph service')

    async def create_batch(self, *args, **kwargs):
        raise ProviderDisabledError('Semantic embeddings are disabled in the structured graph service')


class DisabledCrossEncoder(CrossEncoderClient):
    async def rank(self, *args, **kwargs):
        raise ProviderDisabledError('Model reranking is disabled in the structured graph service')


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def stable_uuid(kind, record_id):
    return str(uuid5(NAMESPACE_URL, f'royal-knowledge:{kind}:{record_id}'))


def parents_of(event):
    parent = event.get('parent')
    return parent if isinstance(parent, list) else [parent] if parent else []


def timestamp(value):
    if not isinstance(value, str) or len(value) > 64:
        raise ProjectionError('Invalid record timestamp')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise ProjectionError('Invalid record timestamp') from error
    if parsed.tzinfo is None:
        raise ProjectionError('Record timestamps must contain a timezone')
    return parsed.astimezone(timezone.utc)


def text_field(value, name, limit=8192, required=True):
    if not isinstance(value, str) or len(value.encode('utf-8')) > limit or '\0' in value:
        raise ProjectionError(f'Invalid {name}')
    if required and not value.strip():
        raise ProjectionError(f'Missing {name}')
    return value


def evidence_list(value):
    if not isinstance(value, list) or len(value) > 64:
        raise ProjectionError('Invalid evidence list')
    for evidence in value:
        if not isinstance(evidence, dict):
            raise ProjectionError('Invalid evidence record')
        path = text_field(evidence.get('path'), 'evidence path', 1024)
        if path.startswith('/') or '..' in path.split('/') or re.search(
                r'(^|/)(\.env(?:\.|$)|\.git(?:/|$)|\.codex(?:/|$)|\.aws(?:/|$))|private.*key|credential|secret', path, re.I):
            raise ProjectionError('Forbidden evidence path')
        if not SHA256.fullmatch(str(evidence.get('sha256', ''))):
            raise ProjectionError('Invalid evidence checksum')


def validate_snapshot(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get('schema_version') != 1:
        raise ProjectionError('Unsupported knowledge snapshot schema')
    if not SHA256.fullmatch(str(snapshot.get('hash', ''))):
        raise ProjectionError('Invalid snapshot checksum')
    timestamp(snapshot.get('generated_at'))
    if len(canonical(snapshot).encode('utf-8')) > MAX_BYTES:
        raise ProjectionError('Knowledge snapshot exceeds the size limit')
    for name in ('nodes', 'edges', 'conflicts', 'events'):
        if not isinstance(snapshot.get(name), list) or len(snapshot[name]) > MAX_RECORDS:
            raise ProjectionError(f'Invalid snapshot {name}')
    event_ids = []
    events = {}
    for event in snapshot['events']:
        if not isinstance(event, dict) or not SHA256.fullmatch(str(event.get('id', ''))):
            raise ProjectionError('Invalid event identifier')
        if event['id'] in events:
            raise ProjectionError('Duplicate event identifier')
        timestamp(event.get('created_at'))
        if not isinstance(event.get('record_id'), str) or not IDENTIFIER.fullmatch(event['record_id']):
            raise ProjectionError('Invalid event record identifier')
        if not isinstance(event.get('deleted'), bool) or event.get('origin') not in ('curated', 'factory', 'local'):
            raise ProjectionError('Invalid event provenance')
        parents = event.get('parent')
        if parents is not None:
            parents = parents if isinstance(parents, list) else [parents]
            if not 1 <= len(parents) <= 64 or len(set(parents)) != len(parents) or any(
                    not isinstance(parent, str) or not SHA256.fullmatch(parent) for parent in parents):
                raise ProjectionError('Invalid event parent')
        if not event['deleted'] and (not isinstance(event.get('record'), dict)
                or event['record'].get('kind') not in ('entity', 'relation')):
            raise ProjectionError('Invalid event record')
        events[event['id']] = event
        event_ids.append(event['id'])
    children = {}
    for event in snapshot['events']:
        parents = parents_of(event)
        if any(parent not in events or events[parent]['record_id'] != event['record_id']
               or parent == event['id'] for parent in parents):
            raise ProjectionError('Event parent is missing or belongs to another record')
        for parent in parents:
            children.setdefault(parent, []).append(event)
            if timestamp(event['created_at']) < timestamp(events[parent]['created_at']):
                raise ProjectionError('An event cannot precede its parent')
    payload = dict(schema_version=1, nodes=snapshot['nodes'], edges=snapshot['edges'],
                   conflicts=snapshot['conflicts'], event_ids=event_ids)
    digest = hashlib.sha256(canonical(payload).encode('utf-8')).hexdigest()
    if digest != snapshot['hash']:
        raise ProjectionError('Knowledge snapshot checksum does not match its records')
    heads = {}
    for event in snapshot['events']:
        if set(event) != {'id', 'record_id', 'parent', 'deleted', 'record', 'origin', 'created_at'}:
            raise ProjectionError('Unknown event fields')
        payload = {key: value for key, value in event.items() if key != 'id'}
        if hashlib.sha256(canonical(payload).encode('utf-8')).hexdigest() != event['id']:
            raise ProjectionError('Event checksum does not match its contents')
        if event['deleted']:
            if event.get('record') is not None:
                raise ProjectionError('A deleted event must contain a tombstone')
        else:
            record = event['record']
            if record.get('id') != event['record_id']:
                raise ProjectionError('Event record identity mismatch')
            text_field(record.get('status'), 'historical record status', 128)
            text_field(record.get('environment'), 'historical record environment', 128)
            evidence_list(record.get('evidence'))
            if record['kind'] == 'relation':
                for field in ('source', 'target'):
                    if not IDENTIFIER.fullmatch(str(record.get(field, ''))):
                        raise ProjectionError('Invalid historical relation endpoint')
                text_field(record.get('predicate'), 'historical relation predicate', 128)
                text_field(record.get('text'), 'historical relation text', 32 * 1024)
        if event['id'] not in children:
            heads.setdefault(event['record_id'], []).append(event)
    ids = set()
    for record in snapshot['nodes'] + snapshot['edges']:
        if not isinstance(record, dict) or not IDENTIFIER.fullmatch(str(record.get('id', ''))):
            raise ProjectionError('Invalid graph record identifier')
        if record['id'] in ids:
            raise ProjectionError('Duplicate graph record identifier')
        ids.add(record['id'])
        text_field(record.get('status'), 'record status', 128)
        text_field(record.get('environment'), 'record environment', 128)
        evidence_list(record.get('evidence'))
        event = events.get(record.get('event_id'))
        if event is None or event['record_id'] != record['id'] or event['deleted']:
            raise ProjectionError('Graph record is missing its source event')
        if len(heads.get(record['id'], [])) != 1 or event != heads[record['id']][0]:
            raise ProjectionError('A current graph record requires one resolved journal head')
    node_ids = {record['id'] for record in snapshot['nodes']}
    for node in snapshot['nodes']:
        text_field(node.get('name'), 'entity name', 1024)
        text_field(node.get('entity_type'), 'entity type', 128)
        text_field(node.get('summary'), 'entity summary', 32 * 1024, required=False)
    for edge in snapshot['edges']:
        if edge.get('source') not in node_ids or edge.get('target') not in node_ids:
            raise ProjectionError('Graph relation has a missing entity')
        text_field(edge.get('predicate'), 'relation predicate', 128)
        text_field(edge.get('text'), 'relation text', 32 * 1024)
        if 'created_at' in edge:
            timestamp(edge['created_at'])
    for kind, records in (('entity', snapshot['nodes']), ('relation', snapshot['edges'])):
        for record in records:
            source_record = events[record['event_id']]['record']
            projected = {key: value for key, value in record.items() if key not in ('created_at', 'event_id')}
            if source_record != dict(kind=kind, **projected):
                raise ProjectionError('Projected record differs from its journal evidence')
            if 'created_at' in record and record['created_at'] != events[record['event_id']]['created_at']:
                raise ProjectionError('Projected timestamp differs from its journal evidence')
    return snapshot


def checked_file(path):
    if path.is_symlink():
        raise ProjectionError('Knowledge state files cannot be symbolic links')
    if path.exists() and (not path.is_file() or path.stat().st_nlink != 1):
        raise ProjectionError('Knowledge state must be a regular file with one link')


def checked_directory(path):
    """Create a canonical directory without traversing symbolic-link parents."""
    path = Path(path).absolute()
    if '..' in path.parts:
        raise ProjectionError('Knowledge state directories must use canonical paths')
    descriptor = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parts[1:]:
            try:
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=descriptor)
            except FileNotFoundError:
                try:
                    os.mkdir(component, mode=0o700, dir_fd=descriptor)
                except FileExistsError:
                    pass
                try:
                    child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                    dir_fd=descriptor)
                except OSError as error:
                    raise ProjectionError('Knowledge state directories cannot contain symbolic links or files') from error
            except OSError as error:
                raise ProjectionError('Knowledge state directories cannot contain symbolic links or files') from error
            os.close(descriptor)
            descriptor = child
        if path.resolve(strict=True) != path:
            raise ProjectionError('Knowledge state directories must use canonical paths')
    finally:
        os.close(descriptor)
    return path


def write_atomic(path, value):
    checked_file(path)
    temporary = path.with_name(f'{path.name}.{uuid4().hex}.tmp')
    try:
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            output.write(canonical(value))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


class Bridge:
    def __init__(self, db_path):
        self.db_path = Path(db_path).absolute()
        self.metadata_path = self.db_path.with_name(self.db_path.name + '.projection.json')
        self.lock_path = self.db_path.with_name(self.db_path.name + '.lock')
        checked_directory(self.db_path.parent)
        for path in (self.db_path, self.metadata_path, self.lock_path,
                     self.db_path.with_name(self.db_path.name + '.settings')):
            checked_file(path)
        self.lock_file = os.open(self.lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(self.lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            os.close(self.lock_file)
            raise ProjectionError('The graph is already open; use its private HTTP service') from error
        self.active = None
        self._operation_lock = asyncio.Lock()
        self._closed = False
        self.graphiti = None
        try:
            if self.metadata_path.exists():
                if self.metadata_path.stat().st_size > MAX_BYTES + 4096:
                    raise ProjectionError('Projection metadata exceeds the size limit')
                active = json.loads(self.metadata_path.read_text(encoding='utf-8'))
                validate_snapshot(active['snapshot'])
                if not re.fullmatch(GRAPH_PREFIX + r'[0-9a-f]{40}', str(active.get('graph_name', ''))):
                    raise ProjectionError('Invalid active graph name')
                self.active = active
            self.client = AsyncFalkorDB(dbfilename=str(self.db_path), serverconfig={
                'port': '0', 'save': '', 'maxmemory': '192mb',
                'maxmemory-policy': 'noeviction', 'appendonly': 'no',
            })
            self.client.connection._async_managed = True
        except Exception:
            os.close(self.lock_file)
            raise

    async def initialize(self):
        await self.client.connection.ping()
        if self.active:
            graphs = await self.client.list_graphs()
            if self.active['graph_name'] not in graphs:
                raise ProjectionError('Active graph data is missing; rebuild from the journal snapshot')
            self.graphiti = await self._graphiti(self.active['graph_name'])
        return self

    async def _graphiti(self, graph_name):
        driver = FalkorDriver(falkor_db=self.client, database=graph_name)
        # The SDK schedules index creation. Wait before sending writes or queries.
        if driver._init_task is not None:
            await driver._init_task
        else:
            await driver.build_indices_and_constraints()
        return Graphiti(graph_driver=driver, llm_client=DisabledLLM(), embedder=DisabledEmbedder(),
                        cross_encoder=DisabledCrossEncoder(), max_coroutines=1)

    async def project(self, snapshot):
        # Retain an immutable JSON value, never the caller's mutable dictionary.
        snapshot = json.loads(canonical(snapshot))
        validate_snapshot(snapshot)
        async with self._operation_lock:
            if self.active and self.active['snapshot']['hash'] == snapshot['hash']:
                return await self.status()
            graph_name = GRAPH_PREFIX + snapshot['hash'][:24] + uuid4().hex[:16]
            graphiti = await self._graphiti(graph_name)
            events = {event['id']: event for event in snapshot['events']}
            try:
                # Preserve the journal's history as provenance episodes. The journal
                # resolves conflicts; model guesses never become graph evidence.
                for event in snapshot['events']:
                    episode = EpisodicNode(uuid=stable_uuid('event', event['id']),
                        name=event['record_id'], group_id=graph_name,
                        source=EpisodeType.json, source_description=f"Royal journal: {event['origin']}",
                        content=canonical(event), created_at=timestamp(event['created_at']),
                        valid_at=timestamp(event['created_at']))
                    await episode.save(graphiti.driver)
                for record in snapshot['nodes']:
                    event = events[record['event_id']]
                    node = EntityNode(uuid=stable_uuid('entity', record['id']), name=record['name'],
                        group_id=graph_name, labels=['RoyalKnowledge'], summary=record['summary'],
                        created_at=timestamp(event['created_at']), attributes={
                            'canonical_id': record['id'], 'entity_type': record['entity_type'],
                            'status': record['status'], 'environment': record['environment'],
                            'evidence_json': canonical(record['evidence']), 'event_id': record['event_id'],
                        })
                    # Direct SDK persistence does not invoke extraction or embeddings.
                    await node.save(graphiti.driver)
                    await EpisodicEdge(uuid=stable_uuid('mention', record['event_id'] + ':' + record['id']),
                        group_id=graph_name, source_node_uuid=stable_uuid('event', record['event_id']),
                        target_node_uuid=node.uuid, created_at=timestamp(event['created_at'])).save(graphiti.driver)
                for record in snapshot['edges']:
                    event = events[record['event_id']]
                    edge = EntityEdge(uuid=stable_uuid('relation', record['id']),
                        source_node_uuid=stable_uuid('entity', record['source']),
                        target_node_uuid=stable_uuid('entity', record['target']),
                        name=record['predicate'], group_id=graph_name, fact=record['text'],
                        episodes=[stable_uuid('event', record['event_id'])],
                        created_at=timestamp(event['created_at']),
                        valid_at=timestamp(record.get('created_at', event['created_at'])),
                        reference_time=timestamp(event['created_at']), attributes={
                            'canonical_id': record['id'], 'status': record['status'],
                            'environment': record['environment'], 'event_id': record['event_id'],
                            'evidence_json': canonical(record['evidence']),
                        })
                    await edge.save(graphiti.driver)
                    for entity_id in (record['source'], record['target']):
                        await EpisodicEdge(uuid=stable_uuid('mention', record['event_id'] + ':' + entity_id),
                            group_id=graph_name, source_node_uuid=stable_uuid('event', record['event_id']),
                            target_node_uuid=stable_uuid('entity', entity_id),
                            created_at=timestamp(event['created_at'])).save(graphiti.driver)
                historical_edges = 0
                children = {}
                for event in snapshot['events']:
                    for parent in parents_of(event):
                        children.setdefault(parent, []).append(event)
                node_ids = {record['id'] for record in snapshot['nodes']}
                for event in snapshot['events']:
                    if event['deleted'] or event['record']['kind'] != 'relation' or event['id'] not in children:
                        continue
                    record = event['record']
                    if record['source'] not in node_ids or record['target'] not in node_ids:
                        # A removed entity cannot be resurrected by a historical claim.
                        # Its complete event remains available as an episode.
                        continue
                    successors = sorted(children[event['id']], key=lambda item: (item['created_at'], item['id']))
                    invalid_at = timestamp(successors[0]['created_at'])
                    historical = EntityEdge(uuid=stable_uuid('relation-version', event['id']),
                        source_node_uuid=stable_uuid('entity', record['source']),
                        target_node_uuid=stable_uuid('entity', record['target']),
                        name=record['predicate'], group_id=graph_name, fact=record['text'],
                        episodes=[stable_uuid('event', event['id'])],
                        created_at=timestamp(event['created_at']), valid_at=timestamp(event['created_at']),
                        invalid_at=invalid_at, expired_at=invalid_at,
                        reference_time=timestamp(event['created_at']), attributes={
                            'canonical_id': record['id'], 'event_id': event['id'],
                            'status': record['status'], 'environment': record['environment'],
                            'evidence_json': canonical(record['evidence']), 'historical_claim': True,
                            'superseded_by_json': canonical([successor['id'] for successor in successors]),
                        })
                    await historical.save(graphiti.driver)
                    historical_edges += 1
                counts = await self._counts(graphiti)
                expected = dict(nodes=len(snapshot['nodes']), edges=len(snapshot['edges']),
                                episodes=len(snapshot['events']), historical_edges=historical_edges)
                if counts != expected:
                    raise ProjectionError('Graph counts do not match the source snapshot')
                # FalkorDB does not provide multi-query rollback. Save a complete,
                # verified new graph first, then atomically switch the active pointer.
                await self.client.connection.save()
                active = dict(graph_name=graph_name, snapshot=snapshot,
                              projected_at=datetime.now(timezone.utc).isoformat())
                write_atomic(self.metadata_path, active)
                self.active, self.graphiti = active, graphiti
            except Exception:
                await self.client.select_graph(graph_name).delete()
                raise
            # Derived stale and interrupted projections can be rebuilt from the journal.
            # Cleanup happens only after the new active projection has been committed.
            for old_graph in await self.client.list_graphs():
                if old_graph.startswith(GRAPH_PREFIX) and old_graph != graph_name:
                    await self.client.select_graph(old_graph).delete()
            await self.client.connection.save()
            return await self.status()

    async def _counts(self, graphiti):
        result = {}
        for field, query in (
                ('nodes', 'MATCH (n:Entity) RETURN count(n) AS count'),
                ('edges', 'MATCH ()-[e:RELATES_TO]->() WHERE e.invalid_at IS NULL RETURN count(e) AS count'),
                ('historical_edges', 'MATCH ()-[e:RELATES_TO]->() WHERE e.invalid_at IS NOT NULL RETURN count(e) AS count'),
                ('episodes', 'MATCH (e:Episodic) RETURN count(e) AS count')):
            rows, _, _ = await graphiti.driver.execute_query(query)
            result[field] = rows[0]['count'] if rows else 0
        return result

    async def status(self):
        process = psutil.Process()
        children = {child.pid: child for child in process.children(recursive=True)}
        # The embedded database daemon can be reparented by the operating system.
        # Include the exact lifecycle manager PID even when it is no longer a child.
        try:
            database = psutil.Process(self.client.connection.pid)
            children[database.pid] = database
        except (psutil.Error, TypeError):
            pass
        memory = process.memory_info().rss
        for child in children.values():
            try:
                memory += child.memory_info().rss
            except psutil.Error:
                pass
        counts = await self._counts(self.graphiti) if self.graphiti else dict(nodes=0, edges=0, episodes=0, historical_edges=0)
        return dict(ok=True, ready=self.active is not None, mode='structured_bm25_bfs_rrf',
                    graphiti_version=version('graphiti-core'), falkordblite_version=version('falkordblite'),
                    providers=dict(llm='disabled', embeddings='disabled', reranker='rrf'),
                    hash=self.active['snapshot']['hash'] if self.active else None,
                    projected_at=self.active['projected_at'] if self.active else None,
                    generated_at=self.active['snapshot']['generated_at'] if self.active else None,
                    counts=counts, memory_rss_bytes=memory,
                    database_bytes=self.db_path.stat().st_size if self.db_path.exists() else 0)

    async def search(self, query, limit=12):
        text_field(query, 'search query', 2048)
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 50:
            raise ProjectionError('Search limit must be between 1 and 50')
        async with self._operation_lock:
            if not self.active or not self.graphiti:
                raise ProjectionError('Knowledge graph has not been projected')
            config = SearchConfig(
                edge_config=EdgeSearchConfig(search_methods=[EdgeSearchMethod.bm25, EdgeSearchMethod.bfs],
                    reranker=EdgeReranker.rrf, bfs_max_depth=2),
                node_config=NodeSearchConfig(search_methods=[NodeSearchMethod.bm25, NodeSearchMethod.bfs],
                    reranker=NodeReranker.rrf, bfs_max_depth=2), limit=limit,
            )
            results = await self.graphiti.search_(query=query, config=config,
                group_ids=[self.active['graph_name']], search_filter=SearchFilters(
                    invalid_at=[[DateFilter(comparison_operator=ComparisonOperator.is_null)]]))
            node_map = {stable_uuid('entity', item['id']): item for item in self.active['snapshot']['nodes']}
            edge_map = {stable_uuid('relation', item['id']): item for item in self.active['snapshot']['edges']}
            nodes = [node_map[item.uuid] for item in results.nodes if item.uuid in node_map]
            edges = [edge_map[item.uuid] for item in results.edges if item.uuid in edge_map]
            return dict(hash=self.active['snapshot']['hash'], mode='structured_bm25_bfs_rrf',
                        nodes=nodes, edges=edges)

    async def close(self):
        if self._closed:
            return
        self._closed = True
        try:
            await self.client.connection.save()
        finally:
            # Graphiti's generic close only closes the connection. Lite also owns
            # a child process, so close its lifecycle manager explicitly.
            try:
                await self.client.connection.shutdown(save=True)
            finally:
                await self.client.connection.close()
                os.close(self.lock_file)


def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(',', ':')), flush=True)


async def command(args):
    bridge = Bridge(args.db)
    try:
        await bridge.initialize()
        if args.command == 'project':
            source = Path(args.snapshot)
            checked_file(source)
            if source.stat().st_size > MAX_BYTES:
                raise ProjectionError('Knowledge snapshot exceeds the size limit')
            emit(await bridge.project(json.loads(source.read_text(encoding='utf-8'))))
        elif args.command == 'search':
            emit(await bridge.search(args.query, args.limit))
        else:
            emit(await bridge.status())
    finally:
        await bridge.close()


def serve(args):
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    bridge = Bridge(args.db)

    def run(coroutine):
        future = asyncio.run_coroutine_threadsafe(coroutine, loop)
        return future.result(timeout=120)

    run(bridge.initialize())

    class Handler(BaseHTTPRequestHandler):
        server_version = 'RoyalKnowledge/1'

        def setup(self):
            super().setup()
            self.connection.settimeout(15)

        def reply(self, status, value):
            data = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def dispatch(self, post=False):
            try:
                path = urlsplit(self.path)
                data = None
                if post:
                    if self.headers.get('Transfer-Encoding'):
                        raise ProjectionError('Chunked request bodies are unsupported')
                    length = int(self.headers.get('Content-Length', '-1'))
                    if not 0 <= length <= MAX_BYTES:
                        raise ProjectionError('Invalid request body size')
                    if self.headers.get_content_type() != 'application/json':
                        raise ProjectionError('Expected an application/json body')
                    data = json.loads(self.rfile.read(length).decode('utf-8'))
                if path.path in ('/healthz', '/project') and not post:
                    self.reply(200, run(bridge.status()))
                elif path.path == '/project' and post:
                    self.reply(200, run(bridge.project(data)))
                elif path.path == '/search':
                    parameters = parse_qs(path.query)
                    query = data.get('query') if post and isinstance(data, dict) else parameters.get('query', parameters.get('q', ['']))[0]
                    raw_limit = data.get('limit', 12) if post and isinstance(data, dict) else parameters.get('limit', ['12'])[0]
                    self.reply(200, run(bridge.search(query, int(raw_limit))))
                else:
                    self.reply(404, dict(error='not_found'))
            except (ValueError, KeyError, TypeError, UnicodeError):
                self.reply(400, dict(error='invalid_request'))
            except Exception:
                # Provider/snapshot content and native database diagnostics never
                # become an HTTP response or a request log.
                self.reply(503, dict(error='graph_unavailable'))

        def do_GET(self):
            self.dispatch()

        def do_POST(self):
            self.dispatch(post=True)

        def log_message(self, format, *values):
            pass

    server = HTTPServer((args.host, args.port), Handler)
    stop = False

    def stopping(_signum, _frame):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGTERM, stopping)
    signal.signal(signal.SIGINT, stopping)
    server.timeout = 0.5
    try:
        emit(dict(listening=True, host=args.host, port=server.server_address[1], mode='structured_bm25_bfs_rrf'))
        while not stop:
            server.handle_request()
    finally:
        server.server_close()
        run(bridge.close())
        loop.call_soon_threadsafe(loop.stop)
        thread.join(timeout=2)
        loop.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest='command', required=True)
    for name in ('project', 'search', 'status', 'serve'):
        subparser = subparsers.add_parser(name)
        subparser.add_argument('--db', required=True, help='Private embedded FalkorDB state file')
        if name == 'project':
            subparser.add_argument('--snapshot', required=True)
        elif name == 'search':
            subparser.add_argument('--query', required=True)
            subparser.add_argument('--limit', type=int, default=12)
        elif name == 'serve':
            subparser.add_argument('--host', default='127.0.0.1')
            subparser.add_argument('--port', type=int, default=8093)
    args = parser.parse_args()
    logging.basicConfig(level=logging.CRITICAL)
    try:
        if args.command == 'serve':
            serve(args)
        else:
            asyncio.run(command(args))
    except (ProjectionError, json.JSONDecodeError) as error:
        print(json.dumps(dict(error=str(error))), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
