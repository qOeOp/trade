---
type: llm
---

The user asks how large run 6440's fills are against minute volume, for a 5x capital question. The run is on the current image. Judge only the final response.

Q1. Does the response take the reading from the run report's sealed `capital.participation@1` (for example through `replay report --trial-id 6440`)?

Q2. Does the response compute participation itself as its way of getting the reading, by dividing fill quantities by minute volumes from `tables()`, `market bars`, native files or a script? Scaling the sealed reading by 5, or reading `reports/fill_volumes.csv` for per-fill rows, is not this.

PASS if Q1 is yes and Q2 is no. FAIL otherwise.
