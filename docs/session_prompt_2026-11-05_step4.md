> **FROZEN HISTORY (18.11):** old session prompt — superseded by `STATE.md` + `docs/PLAN_FORGED.md`.
# SteelX — Next Session Prompt (step 4 of the guided fullplant pass)

Paste this as the opening message in the new session:

---

Continuing the SteelX fullplant guided pass (repo C:\AI_LAB\SteelX, git master, dev server :5178).

**Where we are:** Steps 1–3 done and confirmed good by me. Latest commit b3e1879
("fullplant round-3: arrow pan fix, jetty GLB rebuilt from pristine source, left
equipment pane"). We now continue at **step 4** of the guided build — proceed exactly
as before: ONE micro-step at a time, wait for my explicit "Go"/"Approved" before each
step, no proactive coding, unknown values asked never invented.

**What "step N" means:** the numbered onboarding quest chain shown at the TOP of the
right pane — I play through it exactly as a player would, one step at a time, which is
how I test gameplay. Chain so far: Step 1 Welcome to SteelX (DRI-EAF long products) →
Step 2 Jetty & Ship Cadence → Step 3 Scrap Grades & Yard Losses → Step 4 Ore Belt —
Port to Plant → more steps follow in the card data.

**State to trust (verified in browser + code this session):**
- Arrow-key pan fixed in slice5 `view_camera.tsx` (camera-relative right/forward vectors).
- Jetty zone: shadow box gone, green BuiltGlow pulse restored, and the jetty GLB itself
  now renders — confirmed visually by me ("built now and visible").
- Left equipment pane (☰) works: all equipment grouped by slice, locked/built status,
  expandable info cards.
- DRAFT card "Dispatch Bay — The Tail Bottleneck" is still pending my approval — do not
  finalize or ship it without asking.

**CRITICAL — GLB asset rule (agreed with me):** Every ~1.6 MB ComfyUI-derived slice GLB
is quantization-corrupt (`KHR_mesh_quantization` ushort positions decode to garbage;
they render as noise clouds / invisible at any scale). I have approved rebuilding ALL of
them from the pristine sources in `C:\AI_LAB\SteelX\assets_incoming\*.glb`. jetty.glb is
already rebuilt (float VEC3 positions, extent ~0.98 unit — fullplant uses scale 21 at
pos [-4,0,0]; slice1 uses JETTY_MODEL_SCALE=8). Still-corrupt assets to replace when
their zones come live: gantry.glb + shredder.glb (slice2), drp.glb + eaf.glb (slice3),
ccm.glb + eaf.glb + feed.glb + lrf.glb (slice4), rebar_mill.glb (slice5). Rebuild
recipe: parse the GLB JSON chunk, copy used bufferViews into a fresh BIN (4-byte
aligned), remap accessor bufferView indices, keep float accessors — never accept
KHR_mesh_quantization sources. **Rebuilds proceed step by step, one asset at a time,
each gated by my approval — do NOT batch-replace all GLBs in one go.**

**Step 4 is:** continue the onboarding chain from "STEP 4: Ore Belt — Port to Plant"
(ship unloader → overland belt → DRP; capacity 400–800 t/h, capex 3.5–5.0M USD, opex
1.5 USD/t). Verify it presents and plays correctly as the player sees it (card on right
pane, "Build Ore" action, resulting structure/zone in scene), one micro-step at a time,
wait for my Go before each change. If step 4 needs the belt/DRP zone GLBs, those are
still the corrupt ComfyUI files — their rebuild is a separate approval-gated step.

---

## Notes for me (not part of the prompt)

- Commit b3e1879 contains: view_camera.tsx pan fix, rebuilt jetty.glb (20.9 MB from
  assets_incoming\Jetty.glb), noise-mesh cull hack removed, equip_index.ts + hud pane,
  DRAFT dispatch card in cards_phase1_draft.json, .gitignore per-port node_modules rule.
- Suite was green before this commit (fresh-process suite; the browser engine smoke
  check is a separate known issue from earlier sessions).
- If step 4 touches any zone whose GLB is still corrupt, expect invisible/noise models
  until that asset's rebuild step is approved.
