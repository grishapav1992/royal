---
name: royal-development
description: Implement approved Royal game requirements and repair reported defects while preserving balance invariants, existing interfaces, and traceable verification for the developer stage.
metadata:
  version: "1.2.0"
---

# Royal implementation

Consult knowledge_graph and .factory/knowledge-graph.json for related integrations, source evidence, earlier owner decisions and exact tested candidates. Follow relevant links before asking questions. Preserve task scope of decisions, distinguish candidate from production, and never silently choose between conflicting facts. The graph snapshot hash is fixed for this run.

Read the supplied project_knowledge guide and the relevant contract documents in .factory/project-knowledge.json before editing. Reuse existing integrations and owner decisions from answered questions and task_memory. Check the candidate source when a document describes a later production version. Keep demo, Nile, and disabled mainnet capabilities distinct. A successful candidate from another task has not been deployed unless task_memory explicitly says released.

Start from the approved specification, resolved questions, and any reported defect steps. Inspect the affected handlers and their callers before editing. Preserve existing API and WebSocket contracts unless the specification explicitly changes them. Keep unrelated gameplay and deployment configuration outside the change.

For money operations, retain the established currency units and precision. Check authorization on the server, preserve atomic debit/credit behavior, and use the existing operation identifier or idempotency mechanism so a repeated request cannot create a second financial effect. Consider concurrent operations, insufficient funds, a failed transaction, and reconnecting after a result was committed. Do not turn an unknown result into an automatic new payment or transfer.

Choose verification from the behavior changed. For a repaired financial defect, reproduce the reported trigger and verify the resulting balances and operation records, including the relevant repeat or concurrency case. Reuse existing fixtures and temporary databases. For player-facing changes, inspect the interface in the isolated workspace when a browser check can establish the acceptance criteria.

Report checks that actually ran, their results, and any remaining limitation. A failure in the supplied baseline is evidence to investigate; do not claim the task caused or fixed it without a demonstrated connection. On a QA return, reproduce each reported defect and address its cause within the approved scope.

Git metadata is managed by the controller. Report the current HEAD in artifact.commit and the changed application files; the controller creates and exports the candidate commit afterward. Development finishes with the required developer JSON and verification evidence. Publishing is a separate unavailable stage, not part of this skill.
