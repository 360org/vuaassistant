import { approvedCapabilityFromPrompt, approvalCoversTool } from './capability-rail.js';
import { redactUserVisibleText } from './poll-loop.js';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(
  approvedCapabilityFromPrompt('CALL_APPROVED_CAPABILITY:connector_request\nTiếp tục') === 'connector_request',
  'marker approval not parsed',
);
assert(approvalCoversTool('connector_request', 'connector_request'), 'approval does not cover exact tool');
assert(!approvalCoversTool('connector_request', 'file_write'), 'approval leaked to another tool');
assert(
  redactUserVisibleText('ref vault-entry:mrrxoyss-wk9wby with {{credential:password}}') === 'ref [Vault credential] with [credential]',
  'sensitive chat text not redacted',
);

console.log('approval/redaction self-check passed');
