# RECLAIM — Engineering Proof

## What broke at 2 AM

### 1. The first experiment

[Initial experiment output]

What we observed:
- Baseline recovery: 15.50%
- RECLAIM recovery: 1.95%
- RECLAIM initially performed worse than baseline
- 79 guardrail blocks
- 38 customer contacts
- 38 wasted contacts

### 2. What was actually wrong

[Explain the bugs/design problems we discovered]

### 3. What we changed

[Specific code/design changes]

### 4. The second experiment

[Current experiment output]

- Baseline recovery: 15.50%
- RECLAIM recovery: 18.51%
- Recovery improvement: +19.44%
- Recovered amount: ₹109,029.50
- Attempts: 83 vs 117 baseline
- Human escalations: 18
- Guardrail blocks: 24

### 5. Why the improvement matters

[Interpretation]

### 6. Safety evidence

- Candidate actions are closed
- LLM cannot invent interventions
- Guardrails remain deterministic
- Gateway access is isolated from the AI
- Timeout → reconciliation
- Attempt ceilings are enforced
- etc.

### 7. Final proof

[Final experiment]
[tests]
[typecheck]
[git history]
[demo video]