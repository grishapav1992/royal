---
name: royal-testing
description: Independently verify a Royal game candidate against its acceptance criteria and report reproducible defects using the committed diff, measured fixed checks, and isolated test scenarios for the tester stage.
metadata:
  version: "1.2.0"
---

# Royal candidate verification

Consult knowledge_graph and .factory/knowledge-graph.json for related integrations, source evidence, earlier owner decisions and exact tested candidates. Follow relevant links before asking questions. Preserve task scope of decisions, distinguish candidate from production, and never silently choose between conflicting facts. The graph snapshot hash is fixed for this run.

Read the supplied project_knowledge guide and relevant contract documents in .factory/project-knowledge.json. Use them to identify existing behavior, deployment status, and regression scenarios, while verifying the actual candidate independently. Earlier task reports are contextual evidence, not acceptance proof for this candidate. Preserve the distinction between test-only services, production behavior, and a candidate awaiting release.

Inspect the actual candidate commit and diff, then map the approved acceptance criteria to concrete scenarios and evidence. The developer's report is a starting point, not proof that a behavior works. Confirm which changed path the player or server will execute.

The controller supplies fixed_checks measured before this stage: the build and top-level game server suite. Preserve their reported results. Add focused checks for acceptance criteria that those suites do not cover, using the temporary database and supplied browser configuration when applicable. A command that was not run, a skipped scenario, or an unavailable browser is a verification gap, not a passed check.

For balances and transfers, verify the resulting balances together with the operation record. Include the relevant insufficient-funds, unauthorized, repeat-request, simultaneous-request, and interrupted-connection scenarios. Choose cases from the changed behavior rather than asserting that every possible financial scenario was tested.

Do not edit application source, tests, configuration, or commits. Temporary build outputs and reports are permitted. The controller compares the candidate fingerprint after testing, so changing a test to make it pass invalidates the candidate. If an additional reproduction requires source edits, describe the exact proposed reproduction in the defect report instead of modifying the candidate.

For each defect, provide expected behavior, actual behavior, minimal repeatable steps, severity, and the supporting check or code path. Distinguish a verified product defect from a pre-existing failure and a sandbox limitation; investigate causality rather than inferring it from one error message. Mark passed=true only when the acceptance criteria and mandatory checks are satisfied, and otherwise return the required tester JSON with defects or the concrete missing evidence.
