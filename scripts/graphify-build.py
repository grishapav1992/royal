"""Local structural extraction using the project's pinned Graphify package."""
import json
import os
import sys
from collections import Counter
from pathlib import Path

from graphify.analyze import god_nodes
from graphify.build import build_from_json
from graphify.cluster import cluster, label_communities_by_hub
from graphify.export import to_json
from graphify.extract import extract


def main():
    root = Path.cwd()
    output = root / "graphify-out"
    request = json.load(sys.stdin)
    paths = [root / name for name in request["sources"]]
    print(f"Indexing {len(paths)} tracked source and Markdown files locally.", flush=True)
    extraction = extract(paths, root=root, cache_root=root, max_workers=2)
    if extraction.get("failed_sources"):
        failed = [str(Path(path).relative_to(root)) for path in extraction["failed_sources"]]
        raise RuntimeError("Graphify could not extract these files: " + ", ".join(failed[:20]))
    source_nodes = Counter(node.get("source_file") for node in extraction["nodes"])
    file_only = sum(Path(name).suffix != ".md" and source_nodes[name] == 1 for name in request["sources"])
    graph = build_from_json(extraction, directed=True, root=root, dedup=False)
    communities = cluster(graph)
    labels = label_communities_by_hub(graph, communities)
    destination = output / "graph.next.json"
    if not to_json(graph, communities, str(destination), built_at_commit=request["commit"],
                   community_labels=labels, original_links=extraction["edges"]):
        raise RuntimeError("Graphify declined to write the new graph")
    destination.write_text(destination.read_text(encoding="utf-8").replace("\u2014", "-"), encoding="utf-8")
    data = json.loads(destination.read_text(encoding="utf-8"))
    confidence = Counter(edge.get("confidence", "unknown") for edge in data.get("links", []))
    lines = ["# Royal development map", "", f"Source commit: `{request['commit']}`.", "",
             f"Indexed files: {len(paths)}. Nodes: {len(data['nodes'])}. Edges: {len(data.get('links', []))}.", "",
             "Local AST and Markdown extraction. No model requests or semantic document summaries.",
             "Markdown contributes headings, links and resolvable code references.",
             f"Code files with only a file node (no extracted symbols): {file_only}. Their bodies need direct inspection.",
             "This map describes source relationships, not the production game catalogue or verified owner decisions.", "",
             "## Relationship evidence", ""]
    lines += [f"- {kind}: {count}." for kind, count in sorted(confidence.items())]
    lines += ["", "INFERRED and AMBIGUOUS relationships need source verification. A missing path does not prove no dependency.",
              "", "## Connected symbols", "", "| Symbol | Source | Connections |", "| --- | --- | --- |"]
    for hub in god_nodes(graph, top_n=15):
        node = graph.nodes[hub["id"]]
        label = str(hub["label"]).replace("|", "\\|").replace("\n", " ")
        source = node.get("source_file", "")
        lines.append(f"| {label} | {source} | {hub['degree']} |")
    lines += ["", "Use `npm run graph:query -- \"DemoWalletStore\"` for a scoped view.",
              "Use `npm run graph:explain -- \"PostgresDatabase\"` to inspect a symbol.", ""]
    (output / "GRAPH_REPORT.next.md").write_text("\n".join(lines).replace("\u2014", "-"), encoding="utf-8")


if __name__ == "__main__":
    if os.environ.get("GRAPHIFY_BACKEND") != "none":
        raise RuntimeError("Run through npm run graph:build for the local-only environment")
    main()
