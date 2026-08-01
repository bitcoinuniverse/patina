/* Site map for the PATINA documentation.
   One list, used to build the sidebar, the breadcrumb, the previous and next
   links, and the order the search index walks. Paths are relative to docs/. */

window.PATINA_NAV = [
  {
    id: 'start',
    title: 'Start here',
    pages: [
      { path: 'index.html', title: 'What PATINA is', blurb: 'The one sentence, then the long version.' },
      { path: 'start/firstlight-seals.html', title: 'Firstlight Seals', blurb: 'The founding cohort and how minting works.' },
      { path: 'start/what-you-own.html', title: 'What you actually own', blurb: 'An outpoint, an endowment, and a history.' },
      { path: 'start/limits.html', title: 'What it does not promise', blurb: 'The honest boundaries, stated up front.' }
    ]
  },
  {
    id: 'using',
    title: 'Using it',
    pages: [
      { path: 'using/wallet-setup.html', title: 'Wallet setup', blurb: 'What your wallet must be able to do.' },
      { path: 'using/mint.html', title: 'Mint walkthrough', blurb: 'Commit, wait 144 blocks, reveal.' },
      { path: 'using/artifact-page.html', title: 'Reading your artifact', blurb: 'Every field on the artifact page.' },
      { path: 'using/depth-resets.html', title: 'What resets depth', blurb: 'The full list, and the one case that does not.' },
      { path: 'using/attestations.html', title: 'Attestations', blurb: 'Prove the key is still alive.' },
      { path: 'using/transfer.html', title: 'Transferring an artifact', blurb: 'Any move resets depth to zero.' },
      { path: 'using/recovery.html', title: 'When something goes wrong', blurb: 'Stuck reveals, wrong vouts, lost salts.' }
    ]
  },
  {
    id: 'protocol',
    title: 'Protocol reference',
    pages: [
      { path: 'protocol/identity.html', title: 'Identity and derivations', blurb: 'Domain tags and worked byte examples.' },
      { path: 'protocol/marker-grammar.html', title: 'Marker grammar', blurb: 'The byte table and the selection rule.' },
      { path: 'protocol/seed-rules.html', title: 'SEED rules', blurb: 'Six checks, in order.' },
      { path: 'protocol/keep-rules.html', title: 'KEEP and the default rule', blurb: 'How a successor is chosen.' },
      { path: 'protocol/state-machine.html', title: 'State machine', blurb: 'ALIVE, RELIC, and the transitions between.' },
      { path: 'protocol/rings.html', title: 'Rings', blurb: 'How a completed stretch is engraved.' },
      { path: 'protocol/depth-and-tiers.html', title: 'Depth and tiers', blurb: 'The full table with elapsed time.' },
      { path: 'protocol/reason-codes.html', title: 'Reason codes', blurb: 'All eighteen, and what each means for you.' },
      { path: 'protocol/reorgs.html', title: 'Reorg behavior', blurb: 'Rollback, replay, and finality.' },
      { path: 'protocol/upgrade-boundary.html', title: 'The upgrade boundary', blurb: 'What can change and what cannot.' }
    ]
  },
  {
    id: 'api',
    title: 'Indexer and API',
    pages: [
      { path: 'api/conventions.html', title: 'API conventions', blurb: 'Types, cursors, and pagination.' },
      { path: 'api/endpoints.html', title: 'Endpoint reference', blurb: 'Every endpoint with real examples.' },
      { path: 'api/errors.html', title: 'Error taxonomy', blurb: 'Status codes and error bodies.' },
      { path: 'api/run-an-indexer.html', title: 'Run your own indexer', blurb: 'From a Bitcoin node to a served API.' }
    ]
  },
  {
    id: 'compat',
    title: 'Build a compatible implementation',
    pages: [
      { path: 'compat/build.html', title: 'Build it', blurb: 'The exact steps, in order.' },
      { path: 'compat/golden-vectors.html', title: 'Golden vectors and state roots', blurb: 'What the vectors cover and how to compare.' },
      { path: 'compat/disagreements.html', title: 'Report a disagreement', blurb: 'What to send so it can be resolved.' }
    ]
  },
  {
    id: 'operator',
    title: 'Operator guide',
    pages: [
      { path: 'operator/deploy.html', title: 'Deploy and configure', blurb: 'Requirements, settings, and first run.' },
      { path: 'operator/run.html', title: 'Sync and reindex', blurb: 'Initial sync, catch up, full rebuild.' },
      { path: 'operator/verify.html', title: 'Verify and monitor', blurb: 'What to check and what to alert on.' },
      { path: 'operator/backup.html', title: 'Back up and restore', blurb: 'What is precious and what is derived.' },
      { path: 'operator/incidents.html', title: 'Incident actions', blurb: 'What can be paused and what cannot.' }
    ]
  },
  {
    id: 'creator',
    title: 'Creator guide',
    pages: [
      { path: 'creator/tier-renders.html', title: 'Deterministic tier renders', blurb: 'Same inputs, same picture, everywhere.' },
      { path: 'creator/render-packs.html', title: 'Publish a render pack', blurb: 'Layout, manifest, and checks.' },
      { path: 'creator/render-rules.html', title: 'Rules that keep renders honest', blurb: 'What a render may never do.' }
    ]
  },
  {
    id: 'launch',
    title: 'Launch operations',
    pages: [
      { path: 'launch/checklist.html', title: 'Pre launch checklist', blurb: 'Everything that must be true before announcing.' },
      { path: 'launch/timeline.html', title: 'Timeline', blurb: 'Announcement through day thirty.' },
      { path: 'launch/monitoring.html', title: 'Monitoring and incident response', blurb: 'Signals, thresholds, and the response table.' },
      { path: 'launch/go-no-go.html', title: 'Go, conditional go, no go', blurb: 'The criteria, decided in advance.' }
    ]
  },
  {
    id: 'reference',
    title: 'Glossary and FAQ',
    pages: [
      { path: 'reference/glossary.html', title: 'Glossary', blurb: 'Every term used in these pages.' },
      { path: 'reference/faq.html', title: 'FAQ', blurb: 'The questions people actually ask.' }
    ]
  }
];
