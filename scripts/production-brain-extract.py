"""Extract isolated deployed components, then connect reviewed evidence by content hash."""
import json
import os
import sys
from hashlib import sha256
from pathlib import Path

from graphify.build import build_from_json
from graphify.cluster import cluster, label_communities_by_hub
from graphify.export import to_json
from graphify.extract import extract


def main():
    request = json.loads(Path(sys.argv[1]).read_text())
    nodes = list(request["nodes"])
    edges = list(request["edges"])
    files = {}
    evidence = {}
    components = {item["id"]: item for item in request["components"]}
    for component in request["components"]:
        root = Path(component["root"])
        prefix = component["prefix"]
        extraction = extract([root / name for name in component["sources"]], root=root, cache_root=root, max_workers=1) if component["sources"] else {"nodes": [], "edges": []}
        if extraction.get("failed_sources"):
            raise RuntimeError("Native extraction failed for a verified component")
        local_nodes = []
        for node in extraction["nodes"]:
            node = dict(node)
            node["id"] = prefix + str(node["id"])
            node["label"] = str(node.get("label", "")) + " [" + component["id"] + "]"
            node["component"] = component["id"]
            local_nodes.append(node)
        nodes.extend(local_nodes)
        for edge in extraction["edges"]:
            edges.append({**edge, "source": prefix + str(edge["source"]), "target": prefix + str(edge["target"]), "component": component["id"]})
        for row in component["inputs"]:
            if row.get("evidenceOnly"):
                continue
            path = row["path"]
            file_id = prefix + "file_" + sha256(path.encode()).hexdigest()[:24]
            files[(component["id"], path)] = file_id
            evidence.setdefault((path, row["sha256"]), []).append(file_id)
            nodes.append({"id": file_id, "label": path + " [" + component["id"] + "]", "file_type": "document", "source_file": path,
                          "source_location": "L1", "_origin": "ast", "component": component["id"], "sha256": row["sha256"],
                          "source_coverage": component["coverage"], "reference_only": component["referenceOnly"] or row.get("referenceOnly", False)})
            for package in request["nodes"]:
                if package.get("source_file") == "verified-production-receipt" and package.get("component") == component["id"]:
                    edges.append({"source": package["id"], "target": file_id, "relation": "references_verified_source",
                                  "confidence": "EXTRACTED", "source_file": path, "source_location": "L1", "_origin": "ast"})
            for node in local_nodes:
                if node.get("source_file") == path:
                    edges.append({"source": file_id, "target": node["id"], "relation": "contains_symbol", "confidence": "EXTRACTED",
                                  "source_file": path, "source_location": "L1", "_origin": "ast"})
    for link in request["fileLinks"]:
        component = components[link["component"]]
        targets = [files[(component["id"], link["path"])]] if (component["id"], link["path"]) in files else []
        if not targets:
            row = next((row for row in component["inputs"] if row["path"] == link["path"]), None)
            if row:
                targets = evidence.get((row["path"], row["sha256"]), [])
        if not targets:
            # The receipt proves a live source hash, but there is no compiled-source origin.
            target = component["prefix"] + "reference_" + sha256(link["path"].encode()).hexdigest()[:24]
            if not any(node["id"] == target for node in nodes):
                nodes.append({"id": target, "label": link["path"] + " [verified reference only]", "file_type": "document",
                              "source_file": link["path"], "source_location": "L1", "_origin": "ast", "reference_only": True})
            targets = [target]
        for target in targets:
            edges.append({"source": link["source"], "target": target, "relation": link["relation"], "confidence": "EXTRACTED",
                          "source_file": link["evidence"], "source_location": "L1", "_origin": "ast"})
    graph = build_from_json({"nodes": nodes, "edges": edges}, directed=True, root=Path.cwd(), dedup=False)
    communities = cluster(graph)
    if not to_json(graph, communities, request["output"], built_at_commit=request["commit"],
                   community_labels=label_communities_by_hub(graph, communities), original_links=edges):
        raise RuntimeError("Production graph export failed")
    destination = Path(request["output"])
    destination.write_text(destination.read_text().replace("\u2014", "-"))


if __name__ == "__main__":
    if os.environ.get("GRAPHIFY_BACKEND") != "none":
        raise RuntimeError("Production graph extraction requires the native backend")
    main()
