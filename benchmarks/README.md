# Performance evidence

Measured on Windows x64 on 30 September 2026. `throughput-before.json` and `throughput-after.json` are serial runs of the same controlled, byte-verified 16 MiB fixture. `ui-before.json` is the previous packaged modern UI fixture. Source and packaged final reports are named accordingly. System load and timer resolution affect timings.

`1.2.1/src/` is a frozen source baseline for comparison only; the application builds exclusively from the top-level `src/` directory.

After installing project dependencies, run the current engine with `node test/performance.cjs`. In PowerShell, compare the frozen engine with:

```powershell
$env:ODM_BENCH_ENGINE = (Resolve-Path 'benchmarks/1.2.1/src/engine.cjs').Path
node test/performance.cjs
Remove-Item Env:ODM_BENCH_ENGINE
```

Use `npm run test:modern` for the source UI, or set `ODM_TEST_EXE` to the unpacked executable for packaged UI validation. See PERFORMANCE.md and VERIFICATION.md for interpretation and test scope.
