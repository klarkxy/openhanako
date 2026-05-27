---
name: ontology
description: "类型化知识图谱——结构化实体关系、类型验证数据、跨 skill 共享状态，支持实体 CRUD、依赖查询、多步骤规划。Typed knowledge graph for structured entity relations, type-validated data, and cross-skill shared state."
---

# Ontology

A typed vocabulary + constraint system for representing knowledge as a verifiable graph.

## Knowledge-First Workflow

**在开始任何任务之前，先查询 ontology。** Ontology 是你的结构化记忆——之前积累的知识、关系、项目状态都在这里。跳过这一步等于失忆。

```
1. 收到任务
2. search ontology —— 相关实体是否已存在？
3. 如果存在 → 读取并基于已有知识工作
4. 如果不存在 → 创建新实体，附带溯源信息
5. 工作过程中 → 每次访问实体自动记录 last_queried
6. 任务结束 → 更新相关实体状态
```

### Mandatory First Step

```bash
# 任务开始时，搜索相关实体
python scripts/ontology.py search --keyword "<任务关键词>"
```

即使搜索结果为空，这一步也必须执行——它确认你确实检查过知识库，而非跳过。

## Core Concept

Everything is an **entity** with a **type**, **properties**, and **relations** to other entities. Every mutation is validated against type constraints before committing.

```
Entity: { id, type, properties, relations, created, updated }
Relation: { from_id, relation_type, to_id, properties }
```

## Ontology vs Memory System

| | Ontology (this skill) | Memory System (pin_memory / search_memory) |
|---|---|---|
| **Data** | Typed entities with validated relations | Freeform text snippets |
| **Structure** | Schema-enforced: required fields, enums, cardinality | No schema |
| **Query** | By type + property + relation traversal | Keyword/semantic search |
| **Use case** | Cross-skill data, constraint validation, dependency tracking | Casual notes, facts, preferences |
| **Weight** | Heavy — only for data that needs type safety and linking | Light — anything goes |

→ **Use ontology** when you need type validation, relation traversal, or cross-skill shared state.
→ **Use memory** for quick facts, preferences, casual notes.
→ If you're unsure, start with memory.

## When to Use

| Trigger | Action |
|---------|--------|
| "Link X to Y" | Create relation |
| "Show all tasks for project Z" | Graph traversal |
| "What depends on X?" | Dependency query |
| "What does project Z involve?" | Relation traversal |
| Planning multi-step work | Model as graph transformations |
| Skill needs shared state | Read/write ontology objects |
| Data needs type/schema enforcement | Validate/create typed entities |

## Core Types

```yaml
# Agents & People
Person: { name, email?, phone?, notes? }
Organization: { name, type?, members[] }

# Work
Project: { name, status, goals[], owner? }
Task: { title, status, due?, priority?, assignee?, blockers[] }
Goal: { description, target_date?, metrics[] }

# Time & Place
Event: { title, start, end?, location?, attendees[], recurrence? }
Location: { name, address?, coordinates? }

# Information
Document: { title, path?, url?, summary? }
Message: { content, sender, recipients[], thread? }
Thread: { subject, participants[], messages[] }
# Note: use memory system for casual notes, not ontology

# Resources
Account: { service, username, credential_ref? }
Device: { name, type, identifiers[] }
Credential: { service, secret_ref }  # Never store secrets directly

# Meta
Action: { type, target, timestamp, outcome? }
Policy: { scope, rule, enforcement }
```

## Storage

Default: `OH-Works/ontology/graph.jsonl`

```jsonl
{"op":"create","entity":{"id":"p_001","type":"Person","properties":{"name":"Alice"}}}
{"op":"create","entity":{"id":"proj_001","type":"Project","properties":{"name":"Website Redesign","status":"active"}}}
{"op":"relate","from":"proj_001","rel":"has_owner","to":"p_001"}
```

Query via scripts or direct file ops. For complex graphs, migrate to SQLite.

### Append-Only Rule

When working with existing ontology data or schema, **append/merge** changes instead of overwriting files. This preserves history and avoids clobbering prior definitions.

## Workflows

### Create Entity

```bash
python scripts/ontology.py create --type Person --props '{"name":"Alice","email":"alice@example.com"}'
```

With provenance:

```bash
python scripts/ontology.py create --type Person --props '{"name":"Alice"}' \
  --provenance '{"source_type":"conversation","source_uri":"chat://2026-01-15","confidence":0.8}'
```

### Query

```bash
python scripts/ontology.py query --type Task --where '{"status":"open"}'
python scripts/ontology.py get --id task_001
python scripts/ontology.py related --id proj_001 --rel has_task
python scripts/ontology.py search --keyword "report"
```

### Touch (Mark as Accessed)

```bash
python scripts/ontology.py touch --id task_001
```

### Link Entities

```bash
python scripts/ontology.py relate --from proj_001 --rel has_task --to task_001
```

### Validate

```bash
python scripts/ontology.py validate  # Check all constraints
```

## Provenance (溯源)

Every fact in ontology should carry **provenance** — where it came from, which passage, how confident.

### Creating with Provenance

```bash
python scripts/ontology.py create --type Person \
  --props '{"name":"Alice","email":"alice@example.com"}' \
  --provenance '{"source_type":"document","source_uri":"file:///notes/meeting.md","source_title":"Meeting Notes","section":"Attendees","passage":"Alice was present","confidence":0.9}'
```

This automatically:
1. Creates a `Provenance` entity
2. Links the entity to it via `derived_from` relation
3. Sets `provenance_id` on the entity

### Provenance Fields

| Field | Meaning |
-------|---------
| `source_type` | document, url, conversation, inference, observation |
| `source_uri` | Where the knowledge came from |
| `source_title` | Human-readable title |
| `section` | Section/chapter within source |
| `passage` | Exact passage that supports this fact |
| `confidence` | 0.0–1.0 confidence score |
| `context` | Surrounding context |

### Entity-Level Tracking Fields

Every entity automatically tracks:
- `last_queried` — last time the entity was accessed (auto-updated on get/query)
- `queried_count` — number of times accessed (auto-incremented)
- `provenance_id` — link to Provenance entity (if created with --provenance)

## Usage Tracking

Access tracking is automatic:
- `get_entity()` and `query_entities()` auto-update `last_queried` and increment `queried_count`
- To manually mark an entity as accessed:

```bash
python scripts/ontology.py touch --id task_001
```

Use `queried_count` to identify stale vs. active knowledge. Low count + old `last_queried` = knowledge the AI never uses.

## Search

Search across all entity properties by keyword:

```bash
python scripts/ontology.py search --keyword "meeting"
python scripts/ontology.py search --keyword "Alice" --type Person
```

## Constraints

Define in `OH-Works/ontology/schema.yaml`:

```yaml
types:
  Task:
    required: [title, status]
    status_enum: [open, in_progress, blocked, done]
  
  Event:
    required: [title, start]
    validate: "end >= start if end exists"

  Credential:
    required: [service, secret_ref]
    forbidden_properties: [password, secret, token]  # Force indirection

relations:
  has_owner:
    from_types: [Project, Task]
    to_types: [Person]
    cardinality: many_to_one
  
  blocks:
    from_types: [Task]
    to_types: [Task]
    acyclic: true  # No circular dependencies
```

## Skill Contract

Skills that use ontology should declare:

```yaml
# In SKILL.md frontmatter or header
ontology:
  reads: [Task, Project, Person]
  writes: [Task, Action]
  preconditions:
    - "Task.assignee must exist"
  postconditions:
    - "Created Task has status=open"
```

## Planning as Graph Transformation

Model multi-step plans as a sequence of graph operations:

```
Plan: "Schedule team meeting and create follow-up tasks"

1. CREATE Event { title: "Team Sync", attendees: [p_001, p_002] }
2. RELATE Event -> has_project -> proj_001
3. CREATE Task { title: "Prepare agenda", assignee: p_001 }
4. RELATE Task -> for_event -> event_001
5. CREATE Task { title: "Send summary", assignee: p_001, blockers: [task_001] }
```

Each step is validated before execution. Rollback on constraint violation.

## Integration Patterns

### With Causal Inference

Log ontology mutations as causal actions:

```python
# When creating/updating entities, also log to causal action log
action = {
    "action": "create_entity",
    "domain": "ontology", 
    "context": {"type": "Task", "project": "proj_001"},
    "outcome": "created"
}
```

### Cross-Skill Communication

```python
# Email skill creates commitment
commitment = ontology.create("Commitment", {
    "source_message": msg_id,
    "description": "Send report by Friday",
    "due": "2026-01-31"
})

# Task skill picks it up
tasks = ontology.query("Commitment", {"status": "pending"})
for c in tasks:
    ontology.create("Task", {
        "title": c.description,
        "due": c.due,
        "source": c.id
    })
```

## Quick Start

```bash
# Initialize ontology storage
mkdir -p OH-Works/ontology
touch OH-Works/ontology/graph.jsonl

# Create schema (optional but recommended)
python scripts/ontology.py schema-append --data '{
  "types": {
    "Task": { "required": ["title", "status"] },
    "Project": { "required": ["name"] },
    "Person": { "required": ["name"] }
  }
}'

# Start using
python scripts/ontology.py create --type Person --props '{"name":"Alice"}'
python scripts/ontology.py list --type Person
```

## References

- `references/schema.md` — Full type definitions and constraint patterns
- `references/queries.md` — Query language and traversal examples

## Instruction Scope

Runtime instructions operate on local files (`OH-Works/ontology/graph.jsonl` and `OH-Works/ontology/schema.yaml`) and provide CLI usage for create/query/relate/validate; this is within scope. The skill reads/writes workspace files and will create the `OH-Works/ontology` directory when used. Validation includes property/enum/forbidden checks, relation type/cardinality validation, acyclicity for relations marked `acyclic: true`, and Event `end >= start` checks; other higher-level constraints may still be documentation-only unless implemented in code.
