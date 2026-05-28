---
name: drawing-artifact
label: Drawing Artifact
description: Create editable Drawnix-style visual artifacts for architecture diagrams, flowcharts, mind maps, process maps, and agent-generated drawings that the user can continue editing.
user-invocable: true
argument-hint: "[topic, source text, repo path, mermaid, or markdown outline]"
---

# Drawing Artifact

Use this skill when the user asks for an editable drawing, architecture diagram, flowchart, mind map, visual artifact, whiteboard, Drawnix-style output, Obsidian Drawing/Excalidraw-like artifact, or asks to turn agent output into a diagram they can continue editing.

## Output contract

Prefer a durable, editable drawing source over a static image.

1. If the task starts from system/process/code structure, first produce a concise Mermaid or Markdown outline that can be converted into a drawing.
2. Save editable drawing source under the workspace:
   - `.pikiclaw/artifacts/drawings/<slug>.drawnix.json`
   - optionally `.pikiclaw/artifacts/drawings/<slug>.md` for the source outline
3. In the final answer, include:
   - what the drawing represents
   - the editable source path
   - any static preview/export path if created
   - suggested next edits the user can ask for

## Practical format for now

Until pikiclaw has a native Drawnix editor/viewer, use one of these source formats:

- Mermaid for flowcharts, sequence diagrams, state machines, and architecture flow.
- Markdown outline for mind maps and task decomposition.
- JSON only when you are certain the target schema is valid.

Do not only emit PNG/JPG unless the user explicitly asks for a static image. A static export can accompany the editable source, but it should not be the only artifact.

## When Drawnix support is available

When the dashboard exposes a Drawnix artifact viewer/editor, create or update a `.drawnix` JSON artifact and return it as the primary output. Treat the drawing like an Obsidian Drawing/Excalidraw file: the user can open it, manually edit it, save it, and ask the agent to revise the same artifact later.

## Style guidance

- Keep diagrams useful, not decorative.
- Use stable labels from the source material: service names, module names, file paths, states, actors, and data boundaries.
- Prefer fewer, well-grouped nodes over a dense wall of boxes.
- For repo diagrams, cite concrete files or directories in node labels or notes when possible.
- For incident/log diagrams, preserve exact IDs and timestamps when they are central evidence.

## Default response pattern

After creating the artifact, answer with:

```text
Created editable drawing artifact:
- Source: <path>
- Type: <mermaid | markdown-outline | drawnix-json>
- Represents: <one sentence>

You can ask me to revise the same drawing, for example: "split the runtime box into API / queue / worker" or "turn this into a sequence diagram".
```
