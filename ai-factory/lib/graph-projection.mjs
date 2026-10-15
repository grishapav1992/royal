export class GraphProjection {
  constructor(url = '') { this.url = url.replace(/\/$/, ''); this.hash = null; this.pending = null; this.projectedAt = null; }
  async refresh(snapshot) {
    if (!this.url) return { engine: 'graphiti', status: 'unavailable', error: 'Графовый сервис не подключён.' };
    const pending = (this.pending || Promise.resolve()).catch(() => {}).then(() => this._refresh(snapshot));
    this.pending = pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = null; }
  }
  async _refresh(snapshot) {
    try {
      const health = await fetch(`${this.url}/healthz`, { signal: AbortSignal.timeout(3000) }).then(async response => {
        if (!response.ok) throw new Error('unhealthy'); return response.json();
      });
      if ((health.hash || health.snapshot_hash) !== snapshot.hash) {
        const response = await fetch(`${this.url}/project`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot), signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error('projection failed');
        const result = await response.json();
        if ((result.hash || result.snapshot_hash) !== snapshot.hash) throw new Error('projection mismatch');
        this.projectedAt = result.projected_at || new Date().toISOString();
      }
      this.projectedAt ||= health.projected_at || null;
      this.hash = snapshot.hash;
      return { engine: 'graphiti', status: 'ready', nodes: snapshot.nodes.length, edges: snapshot.edges.length,
        sha256: snapshot.hash, last_projected_at: this.projectedAt, search_mode: 'text_and_relationships' };
    } catch {
      return { engine: 'graphiti', status: 'unavailable', error: 'Graphiti временно недоступен. Проверенные факты сохранены в журнале.' };
    }
  }
  async search(snapshot, query, limit = 60) {
    const projection = await this.refresh(snapshot);
    if (!query || projection.status !== 'ready') return { projection, snapshot: null };
    try {
      const response = await fetch(`${this.url}/search`, { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({query,limit}), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('search failed');
      const result = await response.json();
      if (result.hash !== snapshot.hash || !Array.isArray(result.nodes) || !Array.isArray(result.edges)) throw new Error('search mismatch');
      const ids = new Set(result.nodes.map(node=>node.id)), edgeIds = new Set(result.edges.map(edge=>edge.id));
      for (const edge of snapshot.edges) if (edgeIds.has(edge.id)) { ids.add(edge.source); ids.add(edge.target); }
      return { projection, snapshot: { ...snapshot, nodes: snapshot.nodes.filter(node=>ids.has(node.id)), edges: snapshot.edges.filter(edge=>ids.has(edge.source)&&ids.has(edge.target)) } };
    } catch { return { projection: {...projection, search_status:'unavailable'}, snapshot: null }; }
  }
}
