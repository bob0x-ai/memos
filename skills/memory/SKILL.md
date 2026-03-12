# MEMOS Memory Workflow Skill

## Description
Use this skill for all memory operations with the MEMOS plugin.

This skill is the single source of truth for:
- what to store
- where memories are stored
- which tool to use for team vs company communication
- access expectations by role/policy

## Core Model

- Department memory is stored in department `group_id` (for example `ops`, `devops`).
- Shared company memory is stored in `group_id=company`.
- Access is policy-driven via `access_level` (`public`, `restricted`, `confidential`).
- Do not use legacy scoped commands or a `scope` argument.

## Tool Selection

- `memory_search`
  - Use for explicit recall in allowed scope.

- `memory_store`
  - Use for explicit fact storage in the caller's department.
  - `content_type` and `importance` are optional.
  - `access_level` is optional, but cannot exceed caller policy.

- `memos_announce`
  - Management/confidential only.
  - Use for team-level announcements.
  - Stores to caller department with fixed `access_level=restricted`.

- `memos_broadcast`
  - Management/confidential only.
  - Use for company-wide announcements.
  - Stores to `company` with fixed `access_level=public`.

- `memos_cross_dept`
  - Use for explicit cross-department lookup (policy-gated).

- `memos_drill_down`
  - Confidential only.
  - Expands executive summary IDs into underlying facts.

## Recommended Workflow

1. Private/team memory: use `memory_store`.
2. Team lead announcement: use `memos_announce`.
3. Company-wide policy/update: use `memos_broadcast`.
4. Retrieval: use `memory_search` first, then optional cross-dept/drill-down tools if policy allows.

## Guardrails

- Do not assume company-wide visibility from `public` alone; department scope still matters.
- Use `memos_broadcast` for true org-wide distribution.
- Keep sensitive management discussion in normal flow (auto-capture remains policy-scoped).

## Quick Examples

### Team-level announcement
```json
{ "text": "Deployment freeze starts Friday 18:00 UTC", "content_type": "decision", "importance": 4 }
```
Call: `memos_announce`

### Company-wide broadcast
```json
{ "text": "Postmortems required within 24h for sev-1 incidents", "content_type": "decision", "importance": 5 }
```
Call: `memos_broadcast`
