/* Site map for the PATINA documentation.
   One list, used to build the sidebar, the breadcrumb, the previous and next
   links, the intent routes on the front page, and the order the search index
   walks. Paths are relative to docs/.

   Every page carries a kind, so a reader can tell at a glance what they are
   reading and how much they are allowed to lean on it:

     introductory  orientation. Correct, but it explains rather than binds.
     operational   a procedure to follow. Steps, checks and failure handling.
     normative     the rule as the specification states it. This one binds.
     generated     carries values computed by docs/tools/vectors.mjs and
                   checked digit by digit against the golden vectors.

   Every section carries an intent, which is the sentence a reader would have
   said out loud before they arrived. The front page routes on those. */

window.PATINA_NAV = [
  {
    id: 'start',
    title: 'Start here',
    intent: 'I want to understand PATINA',
    blurb: 'What an artifact is, what you own, and where the edges are.',
    pages: [
      { path: 'index.html', title: 'What PATINA is', kind: 'introductory', blurb: 'The one sentence, then the long version.' },
      { path: 'start/firstlight-seals.html', title: 'Firstlight Seals', kind: 'introductory', blurb: 'The founding cohort and how minting works.' },
      { path: 'start/what-you-own.html', title: 'What you actually own', kind: 'introductory', blurb: 'An outpoint, an endowment, and a history.' },
      { path: 'start/limits.html', title: 'What it does not promise', kind: 'introductory', blurb: 'The honest boundaries, stated up front.' }
    ]
  },
  {
    id: 'using',
    title: 'Using it',
    intent: 'I want a Seal, or I already own an artifact',
    blurb: 'Wallet setup, the mint, reading your artifact, and what to do when it goes wrong.',
    pages: [
      { path: 'using/wallet-setup.html', title: 'Wallet setup', kind: 'operational', blurb: 'What your wallet must be able to do.' },
      { path: 'using/mint.html', title: 'Mint walkthrough', kind: 'operational', blurb: 'Commit, wait 144 blocks, reveal.' },
      { path: 'using/artifact-page.html', title: 'Reading your artifact', kind: 'operational', blurb: 'Every field on the artifact page.' },
      { path: 'using/depth-resets.html', title: 'What resets depth', kind: 'operational', blurb: 'The full list, and the one case that does not.' },
      { path: 'using/attestations.html', title: 'Attestations', kind: 'operational', blurb: 'Prove the key is still alive.' },
      { path: 'using/transfer.html', title: 'Transferring an artifact', kind: 'operational', blurb: 'Any move resets depth to zero.' },
      { path: 'using/recovery.html', title: 'When something goes wrong', kind: 'operational', blurb: 'Stuck reveals, wrong vouts, lost salts.' }
    ]
  },
  {
    id: 'protocol',
    title: 'Protocol reference',
    intent: 'I want to verify an artifact, byte by byte',
    blurb: 'The grammar, the checks in order, the state machine, and every reason code.',
    pages: [
      { path: 'protocol/identity.html', title: 'Identity and derivations', kind: 'generated', blurb: 'Domain tags and worked byte examples.' },
      { path: 'protocol/marker-grammar.html', title: 'Marker grammar', kind: 'generated', blurb: 'The byte table and the selection rule.' },
      { path: 'protocol/seed-rules.html', title: 'SEED rules', kind: 'normative', blurb: 'Six checks, in order.' },
      { path: 'protocol/keep-rules.html', title: 'KEEP and the default rule', kind: 'normative', blurb: 'How a successor is chosen.' },
      { path: 'protocol/state-machine.html', title: 'State machine', kind: 'normative', blurb: 'ALIVE, RELIC, and the transitions between.' },
      { path: 'protocol/rings.html', title: 'Rings', kind: 'normative', blurb: 'How a completed stretch is engraved.' },
      { path: 'protocol/depth-and-tiers.html', title: 'Depth and tiers', kind: 'normative', blurb: 'The full table with elapsed time.' },
      { path: 'protocol/reason-codes.html', title: 'Reason codes', kind: 'normative', blurb: 'All eighteen, and what each means for you.' },
      { path: 'protocol/reorgs.html', title: 'Reorg behavior', kind: 'normative', blurb: 'Rollback, replay, and finality.' },
      { path: 'protocol/upgrade-boundary.html', title: 'The upgrade boundary', kind: 'normative', blurb: 'What can change and what cannot.' }
    ]
  },
  {
    id: 'api',
    title: 'Indexer and API',
    intent: 'I want to integrate PATINA',
    blurb: 'Types, endpoints, errors, and how to point them at your own instance.',
    pages: [
      { path: 'api/conventions.html', title: 'API conventions', kind: 'normative', blurb: 'Types, cursors, and pagination.' },
      { path: 'api/endpoints.html', title: 'Endpoint reference', kind: 'generated', blurb: 'Every endpoint with real examples.' },
      { path: 'api/errors.html', title: 'Error taxonomy', kind: 'normative', blurb: 'Status codes and error bodies.' },
      { path: 'api/run-an-indexer.html', title: 'Run your own indexer', kind: 'operational', blurb: 'From a Bitcoin node to a served API.' }
    ]
  },
  {
    id: 'compat',
    title: 'Build a compatible implementation',
    intent: 'I want to build an indexer',
    blurb: 'The steps in order, the golden vectors, and how to settle a disagreement.',
    pages: [
      { path: 'compat/build.html', title: 'Build it', kind: 'operational', blurb: 'The exact steps, in order.' },
      { path: 'compat/golden-vectors.html', title: 'Golden vectors and state roots', kind: 'generated', blurb: 'What the vectors cover and how to compare.' },
      { path: 'compat/disagreements.html', title: 'Report a disagreement', kind: 'operational', blurb: 'What to send so it can be resolved.' }
    ]
  },
  {
    id: 'operator',
    title: 'Operator guide',
    intent: 'I want to operate infrastructure',
    blurb: 'Deploy, sync, verify, back up, and what an incident can and cannot reach.',
    pages: [
      { path: 'operator/deploy.html', title: 'Deploy and configure', kind: 'operational', blurb: 'Requirements, settings, and first run.' },
      { path: 'operator/run.html', title: 'Sync and reindex', kind: 'operational', blurb: 'Initial sync, catch up, full rebuild.' },
      { path: 'operator/verify.html', title: 'Verify and monitor', kind: 'operational', blurb: 'What to check and what to alert on.' },
      { path: 'operator/backup.html', title: 'Back up and restore', kind: 'operational', blurb: 'What is precious and what is derived.' },
      { path: 'operator/incidents.html', title: 'Incident actions', kind: 'operational', blurb: 'What can be paused and what cannot.' }
    ]
  },
  {
    id: 'creator',
    title: 'Creator guide',
    intent: 'I want to create deterministic artwork',
    blurb: 'Same inputs, same picture, everywhere, and the rules that keep it honest.',
    pages: [
      { path: 'creator/tier-renders.html', title: 'Deterministic tier renders', kind: 'normative', blurb: 'Same inputs, same picture, everywhere.' },
      { path: 'creator/render-packs.html', title: 'Publish a render pack', kind: 'operational', blurb: 'Layout, manifest, and checks.' },
      { path: 'creator/render-rules.html', title: 'Rules that keep renders honest', kind: 'normative', blurb: 'What a render may never do.' }
    ]
  },
  {
    id: 'launch',
    title: 'Launch operations',
    intent: 'I am running the launch',
    blurb: 'The checklist, the timeline, the signals to watch, and the decision criteria.',
    pages: [
      { path: 'launch/checklist.html', title: 'Pre launch checklist', kind: 'operational', blurb: 'Everything that must be true before announcing.' },
      { path: 'launch/timeline.html', title: 'Timeline', kind: 'operational', blurb: 'Announcement through day thirty.' },
      { path: 'launch/monitoring.html', title: 'Monitoring and incident response', kind: 'operational', blurb: 'Signals, thresholds, and the response table.' },
      { path: 'launch/go-no-go.html', title: 'Go, conditional go, no go', kind: 'operational', blurb: 'The criteria, decided in advance.' }
    ]
  },
  {
    id: 'reference',
    title: 'Glossary and FAQ',
    intent: 'I want a word defined, or a question answered',
    blurb: 'Every term used in these pages, and the questions people actually ask.',
    pages: [
      { path: 'reference/glossary.html', title: 'Glossary', kind: 'introductory', blurb: 'Every term used in these pages.' },
      { path: 'reference/faq.html', title: 'FAQ', kind: 'introductory', blurb: 'The questions people actually ask.' }
    ]
  }
];

/* What each kind means, shown next to the badge so it is never a mystery. */
window.PATINA_KINDS = {
  introductory: 'Orientation. Correct, but it explains rather than binds.',
  operational: 'A procedure. Steps, what to check, and what to do when it fails.',
  normative: 'The rule as the specification states it. This one binds.',
  generated: 'Every printed value is computed and checked against the golden vectors.'
};
