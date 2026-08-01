/*
 * PATINA site configuration.
 *
 * Every address the site talks to lives in this file. No page hardcodes a URL.
 * This is a classic script, not an ES module, so the site also works when the
 * files are opened straight from disk. Browsers refuse module imports over the
 * file: scheme, and the brief requires the pages to open from disk.
 *
 * Edit the values below to point the site at a real deployment.
 */
(function (global) {
  'use strict';

  var CONFIG = {
    /*
     * Absolute origin the site is published under. Used for canonical links
     * and social card URLs that were written into the pages. Change the page
     * metadata too if you move the site.
     */
    siteOrigin: 'https://bitcoinuniverse.github.io/patina/',

    /*
     * Base URL of a PATINA indexer, including the base path defined by the
     * frozen API contract in the implementation baseline. Example shape:
     *
     *   https://indexer.example.org/patina
     *
     * Leave this empty and every live panel shows its "connect an indexer"
     * state instead of inventing numbers.
     */
    indexerBase: '',

    /*
     * Base path defined by the frozen indexer API contract, and a placeholder
     * base URL used in the copyable commands on the verify page while no real
     * indexer is configured.
     */
    apiBasePath: '/patina',
    apiBasePlaceholder: 'https://your-indexer.example.org/patina',

    /* Milliseconds before a live request is aborted. */
    requestTimeoutMs: 8000,

    /*
     * Allow a visitor to point the live panels at their own indexer with
     * ?indexer=https://host/path in the address bar. The site shows a banner
     * whenever that override is in use.
     */
    allowIndexerOverride: true,

    /* Bitcoin Universe app. The mint runs inside the app, not on this site. */
    appMintUrl: 'https://inscribe.bitcoinuniverse.io/?tab=patina',
    appName: 'Bitcoin Universe app',

    /*
     * Source repositories named in the implementation baseline. Point these at
     * the published locations for the spec and the test vectors.
     */
    repoUrl: 'https://github.com/bitcoinuniverse/patina',
    specUrl: 'https://github.com/bitcoinuniverse/patina/tree/main/docs/protocol',
    vectorsUrl: 'https://github.com/bitcoinuniverse/patina/tree/main/vectors',
    indexerRepoUrl: 'https://github.com/bitcoinuniverse/index-patina',
    packageName: '@bitcoinuniverse/patina',

    /* Contact for press and brand questions. */
    pressEmail: 'legal@bitcoinuniverse.io'
  };

  /*
   * Frozen protocol constants, copied from the implementation baseline. The
   * simulator on the homepage does its arithmetic against these values.
   */
  var PROTOCOL = {
    markerMagicAscii: 'PTNA',
    markerMagicHex: '50 54 4e 41',
    markerVersion: 1,
    commitMinAge: 144,
    windowLength: 4032,
    graceLength: 4032,
    minCarrierFounding: 100000,
    minCarrierOpen: 10000,
    minSuccessor: 10000,
    maxKeepEntries: 8,
    confirmationsFinal: 6,
    blockSeconds: 600,
    tiers: [
      { index: 0, name: 'Raw', threshold: 0 },
      { index: 1, name: 'Sheen', threshold: 1008 },
      { index: 2, name: 'Cast', threshold: 4032 },
      { index: 3, name: 'Verdigris', threshold: 12960 },
      { index: 4, name: 'Umber', threshold: 26280 },
      { index: 5, name: 'Bronze', threshold: 52560 },
      { index: 6, name: 'Oxide', threshold: 105120 },
      { index: 7, name: 'Elder', threshold: 210000 }
    ]
  };

  global.PATINA_CONFIG = CONFIG;
  global.PATINA_PROTOCOL = PROTOCOL;
})(window);
