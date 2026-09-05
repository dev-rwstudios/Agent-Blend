# Agent-Blend

Control a live Blender session in plain language — no scripting, no manual modeling for anything the asset library already has.

**Before you start:** open Blender, go to the **blend-ai** tab in the N-panel, and click **Start Server**.

### What this does differently
- **Real assets, not guesses.** Furniture and decor requests are handled by a dedicated scene sub-agent that searches a library of accurately-scaled models instead of hand-modeling a rough substitute.
- **You're in the loop.** Scene-changing actions pause for your approval before they run — see exactly what's about to happen and approve, reject, or redirect it. Toggle this in chat settings.
- **Nothing is hidden.** Every tool call streams in live as it happens, so you can watch the work unfold instead of staring at a spinner.
- **Switch models freely.** LM Studio (local) or Gemini (cloud) — pick a provider and model from chat settings at any time.
- **Show it a picture.** Attach an image to your message, or ask it to check a screenshot it just took — both go straight to whichever model you've got active.

### Try it
> Create a red metallic sphere on a white plane with three-point lighting

> Furnish a bedroom with a bed, a nightstand, and a rug

Type `!tools` to browse the full tool catalog, or `!mcp` to see the current connection details.
