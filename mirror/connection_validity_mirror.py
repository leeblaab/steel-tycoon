# SteelX Task 5 - Step 1: Python mirror for connection validity.
# Reads content/nodes/nodes_phase1.json and proves graph rules in pure Python.
# No GDScript, no JSON edits. Run: python mirror/connection_validity_mirror.py

import json
from pathlib import Path

NODES_PATH = Path("C:/AI_LAB/SteelX/content/nodes/nodes_phase1.json")

# --- Data structure: build the graph from the JSON ---
data = json.loads(NODES_PATH.read_text(encoding="utf-8"))
nodes = {n["id"]: n for n in data["phase1_nodes"]}
flow = data["flow"]

# Adjacency built from the flow entries only.
upstream = {}   # node -> list of source nodes
downstream = {} # node -> list of target nodes
for edge in flow:
    # edge from X to Y: X is upstream of Y, Y is downstream of X.
    downstream.setdefault(edge["from"], []).append(edge["to"])
    upstream.setdefault(edge["to"], []).append(edge["from"])

# --- Logic: validation rules ---
def validate_edge(from_id, to_id):
    """Return (ok, reason) for a candidate connection from -> to."""
    if from_id not in nodes or to_id not in nodes:
        return False, "unknown node id"
    if from_id == to_id:
        return False, "self-loop"
    # Rule 1: edge must exist in the declared flow graph.
    if (from_id, to_id) not in {(e["from"], e["to"]) for e in flow}:
        return False, "edge not in declared flow"
    # Rule 2: direction check — 'from' must be upstream of 'to'
    # (i.e. 'to' appears in from's downstream list).
    if to_id not in downstream.get(from_id, []):
        return False, "direction violation (from is not upstream of to)"
    # Rule 3: no cycles in the Phase 1 graph (process flow is strictly forward).
    seen = set()
    stack = [to_id]
    while stack:
        cur = stack.pop()
        if cur == from_id:
            return False, "cycle detected"
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(downstream.get(cur, []))
    return True, "valid"

# --- Prints: report the graph and prove the rules ---
print(f"Nodes: {len(nodes)} | Flow edges: {len(flow)}")
print()
print("Declared graph (node <- upstream | downstream ->):")
for nid in nodes:
    u = upstream.get(nid, [])
    d = downstream.get(nid, [])
    print(f"  {nid:<15} in={u}  out={d}")

print()
print("Validation of every declared edge:")
all_ok = True
for e in flow:
    ok, reason = validate_edge(e["from"], e["to"])
    all_ok = all_ok and ok
    print(f"  {e['from']} -> {e['to']}: {'OK' if ok else 'FAIL'} ({reason})")

print()
print("Negative tests (must FAIL):")
for (a, b) in [("eaf", "drp"),          # reverse direction
               ("scrap_yard", "drp"),   # no declared edge
               ("jetty", "jetty"),      # self-loop
               ("bar_mill", "billet_yard"),  # reverse of declared edge
               ("ghost_node", "eaf")]:  # unknown id
    ok, reason = validate_edge(a, b)
    print(f"  {a} -> {b}: {'OK' if ok else 'FAIL'} ({reason})")

print()
print("RESULT:", "ALL DECLARED EDGES VALID" if all_ok else "FAILURES FOUND")
