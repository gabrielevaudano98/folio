// Folio — the template collection that ships with Folio (D9, gallery). Each is a page with variables
// ({{title}}, {{date}}, {{cursor}}…, see page-templates.js) and is fully editable in the Write view (no raw blocks).
export const CATEGORIES = ['Meetings', 'Planning', 'Product', 'Engineering', 'Reports', 'Docs', 'Personal'];

export const STARTERS = [
  { name: 'Daily note', category: 'Personal', icon: '🗓️', desc: 'Focus, notes and what got done; the page a day link opens', text: `---
tags: [daily]
---
# {{date:dddd D MMMM YYYY}}

[[{{yesterday}}|← Yesterday]] · [[{{tomorrow}}|Tomorrow →]]

## Focus

- [ ] {{cursor}}Top priority

## Notes

## Done today
` },
  { name: 'Meeting notes', category: 'Meetings', icon: '📝', desc: 'Attendees, agenda, decisions, actions', text: `---
tags: [meeting]
date: {{date}}
attendees: []
---
# {{title}}

> [!info] {{date:D MMMM YYYY}}, {{time}}

## Agenda

1. {{cursor}}First topic

## Notes

## Decisions

- What was decided, and why

## Actions

- [ ] Owner: task, by date
` },
  { name: '1:1 meeting', category: 'Meetings', icon: '🤝', desc: 'A recurring one-to-one: updates, topics, feedback, follow-ups', text: `---
tags: [meeting, one-on-one]
date: {{date}}
with: ""
---
# {{title}}

## Since last time

- {{cursor}}What happened

## Topics

- What to talk about

## Feedback

> [!tip] Both ways
> What is going well, what could go better.

## Follow-ups

- [ ] Owner: action
` },
  { name: 'Retrospective', category: 'Meetings', icon: '🔁', desc: 'What went well, what did not, what we change', text: `---
tags: [retro]
date: {{date}}
---
# {{title}}

:::: columns

::: column

### Went well

- {{cursor}}Something to keep

:::

::: column

### Did not go well

- Something to fix

:::

::: column

### We will try

- One change

:::

::::

## Actions

- [ ] Owner: action, by date
` },
  { name: 'Project brief', category: 'Planning', icon: '🎯', desc: 'Problem, goals, scope, milestones, risks', text: `---
tags: [project]
owner: ""
start: {{date}}
status: Not started
---
# {{title}}

[status:: Not started]

## Problem

{{cursor}}

## Goals

- A measurable outcome

## Non-goals

- What this will not do

## Scope and milestones

| Milestone | Date | Owner |
| --- | --- | --- |
|  |  |  |

## Risks

> [!warning] What could stop this

## Links
` },
  { name: 'OKRs', category: 'Planning', icon: '📈', desc: 'Objectives and key results for a quarter, with scores', text: `---
tags: [okr]
period: ""
owner: ""
---
# {{title}}

## Objective 1: {{cursor}}An inspiring goal

| Key result | Start | Target | Now | Score |
| --- | --- | --- | --- | --- |
| A measurable result | 0 | 100 | 0 | 0.0 |
| Another result | 0 | 10 | 0 | 0.0 |

## Objective 2: Another goal

| Key result | Start | Target | Now | Score |
| --- | --- | --- | --- | --- |
| A measurable result | 0 | 100 | 0 | 0.0 |

> [!note] Scoring
> 0.0 to 1.0 at the end of the period; 0.7 is a good score for a stretch goal.
` },
  { name: 'Decision log', category: 'Planning', icon: '⚖️', desc: 'One decision: context, options, outcome (ADR)', text: `---
tags: [decision]
date: {{date}}
status: Proposed
deciders: []
---
# {{title}}

[status:: Proposed]

## Context

{{cursor}}

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| A |  |  |
| B |  |  |

## Decision

## Consequences
` },
  { name: 'Product requirements', category: 'Product', icon: '📦', desc: 'A PRD: problem, users, requirements, success metrics', text: `---
tags: [prd]
owner: ""
status: Draft
---
# {{title}}

[status:: Draft]

## Problem

{{cursor}}Who has it, how often, how much it costs them.

## Users and jobs to be done

- As a …, I want …, so that …

## Requirements

| # | Requirement | Priority | Notes |
| --- | --- | --- | --- |
| 1 |  | Must |  |
| 2 |  | Should |  |

## Out of scope

- Not in this release

## Success metrics

- Metric, baseline, target

## Open questions

- [ ] Question, owner
` },
  { name: 'User interview', category: 'Product', icon: '🎙️', desc: 'Questions, notes and insights from one interview', text: `---
tags: [research, interview]
date: {{date}}
participant: ""
---
# {{title}}

## Context

{{cursor}}Who, role, how we found them.

## Questions

1. Tell me about the last time you …
2. What was hardest about it?
3. What did you try?

## Notes

## Insights

> [!tip] Quote
> Their own words.

## Follow-ups

- [ ] Share with the team
` },
  { name: 'Technical design', category: 'Engineering', icon: '🛠️', desc: 'An RFC: context, proposal, alternatives, rollout', text: `---
tags: [rfc]
author: ""
status: Draft
---
# {{title}}

[status:: Draft]

## Summary

{{cursor}}One paragraph.

## Context

## Proposal

\`\`\`mermaid
flowchart LR
  A[Client] --> B[Service] --> C[(Store)]
\`\`\`

## Alternatives considered

| Option | Why not |
| --- | --- |
|  |  |

## Rollout and risks

- [ ] Feature flag
- [ ] Monitoring

## Open questions
` },
  { name: 'Incident postmortem', category: 'Engineering', icon: '🚨', desc: 'Blameless review: timeline, impact, causes, actions', text: `---
tags: [incident]
date: {{date}}
severity: ""
status: Draft
---
# {{title}}

> [!warning] Blameless
> We look at systems and decisions, not at people.

## Summary

{{cursor}}

## Impact

## Timeline

| Time | What happened |
| --- | --- |
| {{time}} |  |

## Root causes

## What went well

## Actions

- [ ] Owner: action, by date
` },
  { name: 'Status report', category: 'Reports', icon: '📊', desc: 'Weekly progress for stakeholders', text: `---
tags: [status]
week: {{date}}
---
# {{title}}

**Week of {{date:D MMMM YYYY}}** · [status:: In progress]

## Summary

{{cursor}}

## Done

- What shipped

## Next

- What comes next

## Risks and blockers

| Risk | Impact | Owner | Action |
| --- | --- | --- | --- |
|  |  |  |  |

## Asks
` },
  { name: 'Review tracker', category: 'Reports', icon: '✅', desc: 'Items to review, with owner and status', text: `---
tags: [review]
---
# {{title}}

| Item | Owner | Due | Status |
| --- | --- | --- | --- |
| {{cursor}} |  | {{tomorrow}} | [status:: Not started] |

## Checklist

- [ ] Content checked
- [ ] Figures checked
- [ ] Sign-off
` },
  { name: 'How-to guide', category: 'Docs', icon: '📘', desc: 'Steps to get one thing done, with prerequisites', text: `---
tags: [guide]
---
# {{title}}

[TOC]

## Before you start

- {{cursor}}What you need

## Steps

1. First step
2. Second step
3. Third step

> [!tip] Good to know

## Troubleshooting

| Problem | Fix |
| --- | --- |
|  |  |
` },
  { name: 'Weekly review', category: 'Personal', icon: '🧭', desc: 'Look back at the week and plan the next one', text: `---
tags: [weekly]
week: {{date}}
---
# {{title}}

## Wins

- {{cursor}}Something that went well

## Lessons

- Something to remember

## Next week

- [ ] The one thing that matters most
` },
  { name: 'Reading notes', category: 'Personal', icon: '📚', desc: 'Notes on a book or article: ideas, quotes, actions', text: `---
tags: [reading]
author: ""
source: ""
---
# {{title}}

## In one sentence

{{cursor}}

## Key ideas

1. First idea

## Quotes

> A line worth keeping.

## What I will do with it

- [ ] An action
` },
];
