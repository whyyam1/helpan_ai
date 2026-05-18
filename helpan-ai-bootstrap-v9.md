# Helpan AI Rail — New Session Bootstrap

**Purpose:** Copy-paste the block below into the first message of the new design session. Attach the two artefact files (`helpan-ai-rail-instruction.md` and `helpan-ai-rail-one-pager.md`) to the same message.

---

## Copy-paste block

```
You are starting a new dedicated session to design the Helpan AI rail —
the fourth platform rail in the Kirimon Market Ventures stack, alongside
Identiti, Kipkiren Pay, and Todoku.

CONTEXT:
- Silvia Mumbua (CTO) is starting the rail build today, 5 May 2026.
- Chamia Mutuku (CEO and CPO) is the design owner and final approver.
- This design must land before her architectural decisions calcify.
- Two reference documents are attached:
  1. helpan-ai-rail-instruction.md — authoritative Instruction Pack v1.0
  2. helpan-ai-rail-one-pager.md — daily reference companion

WORKING RULES:
- Confirm before proceeding on any significant change.
- All code delivered as downloadable files, never as chat code blocks.
- No hardcoded values in components — design tokens only.
- Reboot packs delivered as both .md and .pdf.
- All Kirimon portfolio apps are M-Pesa Native — design must not break this.
- Apps don't bypass Todoku for user-facing comms — design must enforce this.
- When in doubt about scope between Helpan AI and a platform rail,
  default to the platform rail.
- When in doubt about scope between Helpan AI and a consuming app,
  orchestration lives in the rail, experience lives in the app.

NAMING (current as of 5 May 2026):
- Kipkiren Pay (NOT LipaPlus — LipaPlus has been renamed)
- Lunch Drop (NOT kaLunch — kaLunch has been renamed)
- Identiti (NOT Identity — note the spelling)
- Helpan AI (the rail)
- Helpan family naming: Helpan Lunch Drop, Helpan Chapaa, Helpan
  Kipkiren, Helpan SabakiFresh, Helpan Nightpulse, Helpan [App Name]
  for the new family-discovery app (TBD).

YOUR FIRST TASK:
1. Read the Instruction Pack (helpan-ai-rail-instruction.md) in full.
2. Read the one-pager (helpan-ai-rail-one-pager.md) for orientation.
3. Search past conversations for context on:
   - Kipkiren Pay current platform handoff and capabilities
   - Identiti rail current state
   - Todoku rail current state
   - Chapaa current product design
   - The new family-discovery app brand direction
4. Produce a Confirmation Memo (Output Plan item 1) confirming
   understanding of design law (§3) and strategic context (§4),
   and listing any disagreements or clarifications needed before
   design work begins.
5. Wait for Chamia's confirmation before proceeding to Output Plan
   item 2 (Helpan AI Design Reference).

DO NOT skip the Confirmation Memo. DO NOT proceed past it without
explicit confirmation from Chamia.
```

---

## How to use

1. Open a new Claude session.
2. Attach `helpan-ai-rail-instruction.md` and `helpan-ai-rail-one-pager.md`.
3. Paste the copy-paste block above as the first message.
4. The new session will read both documents, search past conversations for the listed context, and produce the Confirmation Memo.
5. Review the Confirmation Memo. Resolve any clarifications. Then instruct the session to proceed.

---

## Why the Confirmation Memo gate matters

The Confirmation Memo is deliberately the first deliverable. It forces the new session to demonstrate it has actually understood the design law and strategic context before it starts producing artefacts. It also surfaces any disagreement or ambiguity early — when course corrections are cheap — rather than after 30 pages of OpenAPI spec have been written against a misunderstood premise.

Do not skip this gate.

---

*Helpan AI Rail · New Session Bootstrap · 5 May 2026 · Kirimon Market Ventures · Confidential*
