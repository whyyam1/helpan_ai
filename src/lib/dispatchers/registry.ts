/**
 * Build the production dispatcher registry from `AppConfig.outboundDispatch`.
 *
 * Per target rail:
 *   - If `baseUrl` AND `hmacSecret` are set → live HTTP dispatcher.
 *   - Otherwise → `createUnconfiguredDispatcher` returns failed with
 *     `TARGET_RAIL_UNCONFIGURED`. The rail boots, dispatch validates and
 *     persists, only the outbound leg is disabled. Same disabled-by-empty
 *     pattern as H-5 webhooks and H-3 issuance.
 */

import type { AppConfig, OutboundRailConfig } from '../../config/env.js';
import {
  createUnconfiguredDispatcher,
  type DispatcherRegistry,
  type DispatcherTargetRail,
  type TargetRailDispatcher,
} from './dispatcher.js';
import { createHttpDispatcher } from './httpDispatcher.js';

export function buildProductionDispatchers(
  config: AppConfig['outboundDispatch']
): DispatcherRegistry {
  return {
    kipkiren_pay: pickDispatcher('kipkiren_pay', config.kipkirenPay, config),
    todoku: pickDispatcher('todoku', config.todoku, config),
    identiti: pickDispatcher('identiti', config.identiti, config),
  };
}

function pickDispatcher(
  rail: DispatcherTargetRail,
  perRail: OutboundRailConfig,
  config: AppConfig['outboundDispatch']
): TargetRailDispatcher {
  if (!perRail.baseUrl || !perRail.hmacSecret) {
    return createUnconfiguredDispatcher(rail);
  }
  return createHttpDispatcher({
    rail,
    baseUrl: perRail.baseUrl,
    dispatchPath: perRail.dispatchPath,
    appId: perRail.appId,
    hmacSecret: perRail.hmacSecret,
    timestampHeader: config.timestampHeader,
    timeoutMs: config.timeoutMs,
  });
}
