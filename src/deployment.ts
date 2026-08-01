/**
 * Deployment records.
 *
 * A deployment binds the protocol to one network, one founding window and one
 * specification hash. Regtest and signet records ship in this repository.
 * Mainnet stays unset until an activation authorization exists, and the loader
 * refuses to build a mainnet deployment without one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  COMMIT_MIN_AGE,
  GRACE_LENGTH,
  MIN_CARRIER_FOUNDING,
  MIN_CARRIER_OPEN,
  NETWORKS,
  PROTOCOL_ID,
  WINDOW_LENGTH,
  type Network,
} from './constants.js';
import type { DeploymentRecord, WindowState } from './types.js';
import { readField } from './wire.js';

/** Options accepted by the deployment loader. */
export interface LoadOptions {
  /**
   * Set true only when an operator has authorized a mainnet deployment.
   * Without it a mainnet record is refused, whatever the record says.
   */
  readonly mainnetAuthorized?: boolean;
  /**
   * When given, the record's specSha256 must equal this value.
   * Callers that hold the specification bytes should always pass it.
   */
  readonly expectSpecSha256?: string;
}

/** Thrown when a deployment record cannot be trusted. */
export class DeploymentError extends Error {
  public override readonly name = 'DeploymentError';
}

function requireInteger(value: unknown, field: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    throw new DeploymentError(`${field} must be an integer of at least ${min}, got ${String(value)}`);
  }
  return value;
}

function optionalHeight(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  return requireInteger(value, field);
}

/**
 * Validate a raw record and return a frozen deployment.
 *
 * Field names may arrive in the wire form of the specification, which is
 * snake_case, or in the camelCase form this library uses internally. The wire
 * form wins when both are present.
 *
 * Mainnet needs mainnetAuthorized true and at least two named approvers.
 */
export function loadDeployment(raw: unknown, options: LoadOptions = {}): DeploymentRecord {
  if (typeof raw !== 'object' || raw === null) throw new DeploymentError('deployment record must be an object');
  const record = raw as Record<string, unknown>;
  const field = (wireName: string, camelName: string): unknown => readField(record, wireName, camelName);

  const network = record.network;
  if (typeof network !== 'string' || !(NETWORKS as readonly string[]).includes(network)) {
    throw new DeploymentError(`network must be one of ${NETWORKS.join(', ')}, got ${String(network)}`);
  }
  const protocolId = field('protocol_id', 'protocolId');
  if (protocolId !== PROTOCOL_ID) {
    throw new DeploymentError(`protocol_id must be ${PROTOCOL_ID}, got ${String(protocolId)}`);
  }
  const specSha256 = field('spec_sha256', 'specSha256');
  if (typeof specSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(specSha256)) {
    throw new DeploymentError('spec_sha256 must be 64 lowercase hex characters');
  }
  if (options.expectSpecSha256 !== undefined && options.expectSpecSha256 !== specSha256) {
    throw new DeploymentError(`spec_sha256 is ${specSha256}, caller expected ${options.expectSpecSha256}`);
  }

  const hOpen = optionalHeight(field('h_open', 'hOpen'), 'h_open');
  const hClose = optionalHeight(field('h_close', 'hClose'), 'h_close');
  const graceEnd = optionalHeight(field('grace_end', 'graceEnd'), 'grace_end');
  const minCarrierFounding = requireInteger(field('min_carrier_founding', 'minCarrierFounding'), 'min_carrier_founding', 1);
  const minCarrierOpen = requireInteger(field('min_carrier_open', 'minCarrierOpen'), 'min_carrier_open', 1);
  const commitMinAge = requireInteger(field('commit_min_age', 'commitMinAge'), 'commit_min_age', 0);

  if (minCarrierFounding !== MIN_CARRIER_FOUNDING) {
    throw new DeploymentError(`min_carrier_founding is frozen at ${MIN_CARRIER_FOUNDING}`);
  }
  if (minCarrierOpen !== MIN_CARRIER_OPEN) {
    throw new DeploymentError(`min_carrier_open is frozen at ${MIN_CARRIER_OPEN}`);
  }
  if (commitMinAge !== COMMIT_MIN_AGE) {
    throw new DeploymentError(`commit_min_age is frozen at ${COMMIT_MIN_AGE}`);
  }

  const anyHeight = hOpen !== null || hClose !== null || graceEnd !== null;
  const allHeights = hOpen !== null && hClose !== null && graceEnd !== null;
  if (anyHeight && !allHeights) {
    throw new DeploymentError('h_open, h_close and grace_end must all be set or all be null');
  }
  if (allHeights) {
    if (hClose - hOpen !== WINDOW_LENGTH) {
      throw new DeploymentError(`h_close minus h_open must equal WINDOW_LENGTH ${WINDOW_LENGTH}, got ${hClose - hOpen}`);
    }
    if (graceEnd - hClose !== GRACE_LENGTH) {
      throw new DeploymentError(`grace_end minus h_close must equal GRACE_LENGTH ${GRACE_LENGTH}, got ${graceEnd - hClose}`);
    }
  }

  const rawApprovers = record.approvers;
  let approvers: readonly string[] | undefined;
  if (rawApprovers !== undefined && rawApprovers !== null) {
    if (!Array.isArray(rawApprovers) || rawApprovers.some((a) => typeof a !== 'string' || a.trim() === '')) {
      throw new DeploymentError('approvers must be an array of non empty strings');
    }
    approvers = Object.freeze(rawApprovers.map((a) => String(a)));
  }

  if (network === 'mainnet') {
    if (options.mainnetAuthorized !== true) {
      throw new DeploymentError(
        'mainnet deployment refused: pass mainnetAuthorized true only after an activation authorization exists',
      );
    }
    if (approvers === undefined || approvers.length < 2) {
      throw new DeploymentError('mainnet deployment refused: the record must name at least two approvers');
    }
    if (!allHeights) {
      throw new DeploymentError('mainnet deployment refused: the record has no activation heights');
    }
  }

  const out: DeploymentRecord = {
    network: network as Network,
    protocolId: PROTOCOL_ID,
    specSha256,
    hOpen,
    hClose,
    graceEnd,
    minCarrierFounding,
    minCarrierOpen,
    commitMinAge,
  };
  return Object.freeze(approvers === undefined ? out : { ...out, approvers }) as DeploymentRecord;
}

/** Read a deployment record from a JSON file on disk. */
export function loadDeploymentFile(path: string, options: LoadOptions = {}): DeploymentRecord {
  const text = readFileSync(path, 'utf8');
  return loadDeployment(JSON.parse(text), options);
}

const DEPLOYMENT_DIR = new URL('../deployments/', import.meta.url);

/** Read one of the deployment records that ship with this package. */
export function loadShippedDeployment(network: Network, options: LoadOptions = {}): DeploymentRecord {
  const path = fileURLToPath(new URL(`${network}.json`, DEPLOYMENT_DIR));
  return loadDeploymentFile(path, options);
}

/** Build a deployment for a network whose window opens at a chosen height. */
export function deploymentFor(network: Network, hOpen: number, specSha256: string, approvers?: readonly string[]): DeploymentRecord {
  const hClose = hOpen + WINDOW_LENGTH;
  return loadDeployment(
    {
      network,
      protocol_id: PROTOCOL_ID,
      spec_sha256: specSha256,
      h_open: hOpen,
      h_close: hClose,
      grace_end: hClose + GRACE_LENGTH,
      min_carrier_founding: MIN_CARRIER_FOUNDING,
      min_carrier_open: MIN_CARRIER_OPEN,
      commit_min_age: COMMIT_MIN_AGE,
      approvers,
    },
    { mainnetAuthorized: network === 'mainnet' ? false : undefined },
  );
}

/** Founding window state at a tip height. */
export function windowStateAt(deployment: DeploymentRecord, tipHeight: number): WindowState {
  const { hOpen, hClose, graceEnd } = deployment;
  if (hOpen === null || hClose === null || graceEnd === null) return 'PENDING';
  if (tipHeight < hOpen) return 'PENDING';
  if (tipHeight < hClose) return 'OPEN';
  if (tipHeight <= graceEnd) return 'GRACE';
  return 'CLOSED';
}
