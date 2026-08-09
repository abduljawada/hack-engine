window.RUFFLE_MEMORY_STATUS = {
  currentVersion: "0.7",
  currentName: "Candidate workspace",
  state: "Active development",
  progress: 70,
  capabilities: [
    {
      title: "Flexible scans",
      description: "Exact, inclusive-range, and unknown-value scans with aligned or byte-level addressing.",
    },
    {
      title: "Type-free quick scan",
      description: "Use Ruffle movie metadata to guide a simple toolbar scan, with a safe all-format fallback.",
    },
    {
      title: "Comparison refinement",
      description: "Narrow known or unknown baselines by changed, unchanged, increased, decreased, or exact delta.",
    },
    {
      title: "Candidate workspace",
      description: "Filter, sort, select, label, group, and batch-operate on a focused 200-row preview.",
    },
    {
      title: "Live watches",
      description: "Automatically watch interacted values and distinguish persistent writes from game-restored copies.",
    },
    {
      title: "Large-memory resilience",
      description: "Chunked compressed snapshots, cooperative cancellation, and safe handling of growing WASM memory.",
    },
  ],
  builtFor: [
    "Embedded Ruffle players whose state reaches WebAssembly linear memory",
    "Numeric discovery when the Flash or AVM representation is not yet known",
    "Local, authorized inspection through Firefox Developer Tools",
  ],
  notYet: [
    "Pointer-chain discovery and stable address rebasing between sessions",
    "Values held only in JavaScript objects, registers, or encoded structures",
    "A signed store release and a formal cross-browser compatibility guarantee",
  ],
  milestones: [
    {
      version: "0.7",
      name: "Candidate workspace",
      status: "Current",
      state: "current",
      description: "Turn scan results into a manageable working set and make long scans interruptible.",
      items: ["200-row preview", "Type-free popup", "Auto-watch", "Batch actions", "Labels and groups", "Scan history"],
    },
    {
      version: "0.8",
      name: "Address intelligence",
      status: "Planned",
      state: "planned",
      description: "Make useful values easier to rediscover and understand across game screens and sessions.",
      items: ["Pointer experiments", "Address notes", "Value timeline", "Reusable scan profiles"],
    },
    {
      version: "0.9",
      name: "Compatibility and hardening",
      status: "Planned",
      state: "planned",
      description: "Broaden real-game coverage and lock down behavior under large, nested, or changing runtimes.",
      items: ["Game compatibility matrix", "Performance budgets", "Recovery UX", "Chromium validation"],
    },
    {
      version: "1.0",
      name: "Stable release",
      status: "Target",
      state: "planned",
      description: "Ship a documented, reproducible, and supportable Firefox-first release.",
      items: ["Signed package", "User guide", "Security review", "Release artifacts", "Stable data format"],
    },
  ],
};
