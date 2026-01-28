# Plan: Comprehensive Documentation Update to ReadMe.io Spec

## Overview

Update all 144 markdown files in `readme/` to fully comply with ReadMe.io's documentation specification. This will use **8 parallel agents** organized by documentation section and task type.

---

## Phase 1: Parallel Audit Agents (4 agents)

These agents run simultaneously to audit all sections and produce compliance reports.

### Agent 1: Audit `docs/Getting Started/` (13 files)
**Task:** Analyze all files in the Getting Started section including subdirectories (`real-time-api/`, `safety-and-alerts/`, `sse/`)
**Checks:**
- Frontmatter has required fields: `title`, `excerpt`
- Optional fields are valid: `hidden`, `deprecated`, `icon`, `category`, `metadata`
- Callouts use readme.io syntax: `> 📘`, `> 👍`, `> 🚧`, `> ❗️` (not `<Info>`, `<Warning>`, etc.)
- Code blocks have language identifiers
- Tabbed code blocks have no blank lines between them
- `_order.yaml` files reference all pages correctly
**Output:** Report listing non-compliant files and specific issues

### Agent 2: Audit `docs/Recipes/` (15 files)
**Task:** Analyze all recipe files and subdirectories (`discord-alert-bot/`, `export-csv/`, `live-dashboard/`)
**Checks:** Same as Agent 1, plus:
- Recipe frontmatter has valid `recipe:` field (color, icon) if used
- Recipe index properly links to sub-recipes
**Output:** Report listing non-compliant files and specific issues

### Agent 3: Audit `reference/` API docs (127+ files)
**Task:** Analyze all API reference documentation
**Checks:** Same as Agent 1, plus:
- `api:` frontmatter field properly references OpenAPI spec (`file`, `operationId`)
- Endpoint documentation matches OpenAPI definitions
- Authentication documentation is consistent
**Output:** Report listing non-compliant files and specific issues

### Agent 4: Audit `_order.yaml` files (19 files)
**Task:** Validate all ordering files across the documentation
**Checks:**
- Every markdown file is referenced in corresponding `_order.yaml`
- No orphaned references to non-existent files
- Hierarchy structure uses proper YAML indentation
- Parent-child relationships are correctly defined
**Output:** Report of ordering issues and missing/extra references

---

## Phase 2: Parallel Update Agents (4 agents)

After Phase 1 completes, these agents process the audit reports and fix issues.

### Agent 5: Fix Frontmatter Issues (all files)
**Task:** Update frontmatter across all 144 files based on audit reports
**Actions:**
- Add missing `title` fields
- Add/update `excerpt` fields (one-line descriptions)
- Remove invalid frontmatter fields not in readme.io spec
- Standardize `hidden: false` vs omitting the field
- Ensure `slug` values match file names
**ReadMe.io Spec:**
```yaml
---
title: "Page Title"
excerpt: "One-line description"
hidden: false          # optional
deprecated: false      # optional
icon: "fa-icon-name"   # optional, Font Awesome class
category: "Category"   # optional
metadata:              # optional, for SEO
  title: "SEO Title"
  description: "SEO description"
---
```

### Agent 6: Fix Callout Syntax (all files)
**Task:** Convert all non-standard callouts to readme.io blockquote syntax
**Conversions:**
| Current Syntax | ReadMe.io Syntax |
|----------------|------------------|
| `<Info>content</Info>` | `> 📘 Info\n>\n> content` |
| `<Warning>content</Warning>` | `> 🚧 Warning\n>\n> content` |
| `<Success>content</Success>` | `> 👍 Success\n>\n> content` |
| `<Check>content</Check>` | `> 👍\n>\n> content` |
| `:::info` | `> 📘 Info` |
| `:::warning` | `> 🚧 Warning` |

**ReadMe.io Callout Spec:**
```markdown
> 📘 Title Here
>
> Body content here. Can span multiple lines.
```
Emoji mappings:
- `📘` or `ℹ️` → Info (blue)
- `👍` or `✅` → Success (green)
- `🚧` or `⚠️` → Warning (yellow)
- `❗️` or `🛑` → Error (red)

### Agent 7: Fix Code Blocks & Components (all files)
**Task:** Ensure all code blocks and components match readme.io spec
**Actions:**
- Add language identifiers to bare code blocks
- Convert `<Tabs>/<Tab>` components to consecutive code blocks (no blank lines)
- Remove unsupported MDX components: `<Steps>`, `<Step>`, `<CardGroup>`, `<Card>`, `<AccordionGroup>`, `<Accordion>`, `<Checklist>`, `<Cards>`
- Replace with readme.io equivalents or standard markdown

**Tabbed Code Block Spec (no blank lines between):**
```markdown
```javascript Tab Label 1
code here
```
```python Tab Label 2
code here
```
```

**Components to Convert:**
| Custom Component | ReadMe.io Equivalent |
|------------------|----------------------|
| `<Steps>/<Step>` | Numbered list `1. Step one` |
| `<CardGroup>/<Card>` | Standard markdown with headers |
| `<Tabs>/<Tab>` | Consecutive code blocks |
| `<AccordionGroup>/<Accordion>` | Headers with content |
| `<Checklist>` | Markdown checklist `- [ ] Item` |

### Agent 8: Fix `_order.yaml` & Validate Structure
**Task:** Ensure all ordering files are correct and complete
**Actions:**
- Add missing file references to `_order.yaml` files
- Remove references to deleted/non-existent files
- Fix indentation for proper hierarchy
- Validate parent-child nesting structure

**ReadMe.io Ordering Spec:**
```yaml
- page-slug           # top-level page
- parent-page         # parent page
  - child-page-one    # nested under parent-page
  - child-page-two    # nested under parent-page
- another-page        # top-level page
```

---

## Phase 3: Validation Agent (1 agent)

### Agent 9: Final Validation
**Task:** Run comprehensive validation after all fixes
**Checks:**
- All frontmatter is valid YAML
- All callouts render correctly
- All code blocks have language identifiers
- All `_order.yaml` files are complete and valid
- No orphaned files or broken references
- File count matches expected (144 files)
**Output:** Final compliance report

---

## Agent Execution Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                         PHASE 1 (Parallel)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Agent 1  │ │ Agent 2  │ │ Agent 3  │ │ Agent 4  │            │
│  │ Audit    │ │ Audit    │ │ Audit    │ │ Audit    │            │
│  │ Getting  │ │ Recipes  │ │ API Ref  │ │ _order   │            │
│  │ Started  │ │          │ │          │ │ .yaml    │            │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘            │
│       │            │            │            │                   │
│       └────────────┴─────┬──────┴────────────┘                   │
│                          ▼                                       │
│                   [Audit Reports]                                │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                         PHASE 2 (Parallel)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Agent 5  │ │ Agent 6  │ │ Agent 7  │ │ Agent 8  │            │
│  │ Fix      │ │ Fix      │ │ Fix Code │ │ Fix      │            │
│  │ Front-   │ │ Callouts │ │ Blocks & │ │ _order   │            │
│  │ matter   │ │          │ │ Comps    │ │ .yaml    │            │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘            │
│       │            │            │            │                   │
│       └────────────┴─────┬──────┴────────────┘                   │
│                          ▼                                       │
│                    [Fixed Files]                                 │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                         PHASE 3 (Sequential)                     │
│                      ┌──────────┐                                │
│                      │ Agent 9  │                                │
│                      │ Final    │                                │
│                      │ Valid.   │                                │
│                      └────┬─────┘                                │
│                           ▼                                      │
│                   [Compliance Report]                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Inventory

| Section | Path | File Count |
|---------|------|------------|
| Getting Started | `readme/docs/Getting Started/` | 13 |
| Recipes | `readme/docs/Recipes/` | 15 |
| API Reference | `readme/reference/` | 127+ |
| Order Files | `readme/**/_order.yaml` | 19 |
| **Total** | | **144+ markdown, 19 yaml** |

---

## ReadMe.io Specification Summary

### Required Frontmatter
```yaml
---
title: "Page Title"
excerpt: "Brief description"
---
```

### Optional Frontmatter
```yaml
hidden: false
deprecated: false
icon: "fa-icon-class"
category: "Category Name"
metadata:
  title: "SEO Title"
  description: "SEO description"
  keywords: "keyword1, keyword2"
api:
  file: "openapi.json"
  operationId: "getEndpoint"
recipe:
  color: "#4A90E2"
  icon: "fa-code"
```

### Callout Syntax
```markdown
> 📘 Info Title
>
> Content

> 👍 Success Title
>
> Content

> 🚧 Warning Title
>
> Content

> ❗️ Error Title
>
> Content
```

### Code Block Syntax
```markdown
```language
code
```
```

### Tabbed Code Blocks (NO blank lines between)
```markdown
```javascript Tab 1
code1
```
```python Tab 2
code2
```
```

### Ordering File Syntax
```yaml
- page-slug
- parent-page
  - child-one
  - child-two
```

---

## Sources

- [Documentation Structure](https://docs.readme.com/main/docs/documentation-structure)
- [ReadMe-Flavored Markdown](https://docs.readme.com/rdmd/docs/getting-started)
- [Callouts](https://docs.readme.com/rdmd/docs/callouts)
- [Code Blocks](https://docs.readme.com/rdmd/docs/code-blocks)
- [Syncing Docs via CLI](https://docs.readme.com/main/docs/rdme)
