---
name: royal-analysis
description: Analyze Royal game tasks against the existing implementation and prepare scoped subtasks, blocking questions, priorities, and measurable acceptance criteria for the analyst stage.
metadata:
  version: "1.2.0"
---

# Royal task analysis

Consult knowledge_graph and .factory/knowledge-graph.json for related integrations, source evidence, earlier owner decisions and exact tested candidates. Follow relevant links before asking questions. Preserve task scope of decisions, distinguish candidate from production, and never silently choose between conflicting facts. The graph snapshot hash is fixed for this run.

Read the controller-supplied project_knowledge guide and relevant documents in .factory/project-knowledge.json before asking questions. Consult answered questions and task_memory for earlier owner decisions. Describe existing integrations and their verified deployment state with evidence paths, then identify the remaining gap. Historical plans must not override newer verified facts. Ask about unresolved business rules only when they block implementation; do not ask the owner to identify an integration that is already documented.

Use the task description together with the actual workspace. Trace the affected player action through its interface, server handler, storage, and existing tests before proposing work. Cite relevant file paths in the specification so the developer can verify each finding. Distinguish an observed defect, an existing capability, and a product decision that the owner has not made.

For balances, payments, and transfers, identify who authorizes the operation, how its identifier prevents duplicate execution, how concurrent requests affect balances, and where the operation is recorded. Treat interrupted connections and repeated requests as separate acceptance scenarios. Keep the existing currency units and rounding rules unless changing them is part of the approved task.

Make each subtask independently assessable: name the behavior to change, its dependencies, and observable acceptance criteria. Order prerequisites before dependent features. Set priority from the demonstrated impact: P0 for an active critical failure, P1 for a serious blocker or loss risk, P2 for ordinary planned work, P3 for optional improvements. State the evidence behind a higher priority; uncertainty alone does not prove an incident.

Ask a question only when its answer changes implementation or acceptance and cannot be established from the code or task. Record reasonable nonblocking assumptions in scope. Separate unrelated feature requests instead of silently adding them to a repair.

The analyst has a read-only workspace. Produce the required analyst JSON with the specification and questions. A test failure or log may suggest an investigation, but it does not establish a root cause without the relevant execution path and evidence.
