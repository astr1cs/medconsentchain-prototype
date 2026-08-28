/**
 * MedConsentChain — CGP State Machine Invariant Tests
 *
 * Proves three formal properties of the Consent-Gated Proxy pattern:
 *
 *   INV-01: no_access_post_revoke
 *     After revokePermission(), checkPermission() always returns false.
 *
 *   INV-02: no_access_without_grant
 *     Without grantPermission(), checkPermission() always returns false.
 *
 *   INV-03: audit_completeness
 *     Every checkPermission() call emits exactly one AccessLogged event,
 *     on both the allow and deny paths.
 *
 * Run:
 *   npx hardhat test test/MedConsent.invariants.test.js
 *
 * Expected output: 3 passing invariants
 */

'use strict';

const { ethers } = require('hardhat');
const { expect }  = require('chai');

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Generate N random record IDs to test across multiple inputs
function randomRecordIds(n) {
  return Array.from({ length: n }, (_, i) =>
    `inv_rec_${i}_${Math.random().toString(36).slice(2, 8)}`
  );
}

describe('CGP State Machine Invariants', function () {
  let medConsent;
  let patient, providerA, providerB, stranger;

  const CONTENT_HASH = ethers.keccak256(ethers.toUtf8Bytes('invariant_test_data'));
  const IPFS_PTR     = 'ipfs://QmInvariantTest';
  const WRAPPED_KEY  = 'WRAPPED_KEY_INVARIANT_TEST';
  const ONE_HOUR     = 3600;
  const ONE_SECOND   = 1; // nearly-expired permission for expiry tests

  beforeEach(async function () {
    [patient, providerA, providerB, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory('MedConsent', patient);
    medConsent = await Factory.deploy();
    await medConsent.waitForDeployment();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INV-01: no_access_post_revoke
  //
  // Property: ∀ recordId, provider:
  //   revokePermission(recordId, provider) ⟹ checkPermission(recordId, provider) = false
  //
  // Tested across 5 record IDs and 2 provider addresses.
  // ══════════════════════════════════════════════════════════════════════════
  describe('INV-01: no_access_post_revoke', function () {
    it('checkPermission returns false after revocation — single record', async function () {
      const recordId = 'inv01_rec_001';

      // Setup: add record and grant permission
      await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);
      await medConsent.grantPermission(recordId, providerA.address, ONE_HOUR);

      // Verify: permission is granted before revocation
      const txBefore = await medConsent.checkPermission(recordId, providerA.address);
      const rBefore  = await txBefore.wait();
      const logBefore = rBefore.logs.find(l => l.fragment?.name === 'AccessLogged');
      expect(logBefore.args.allowed).to.equal(true, 'Permission should be granted before revocation');

      // Act: revoke permission
      await medConsent.revokePermission(recordId, providerA.address);

      // Assert: INV-01 — permission must be false post-revocation
      const txAfter = await medConsent.checkPermission(recordId, providerA.address);
      const rAfter  = await txAfter.wait();
      const logAfter = rAfter.logs.find(l => l.fragment?.name === 'AccessLogged');
      expect(logAfter.args.allowed).to.equal(false,
        'INV-01 VIOLATED: checkPermission returned true after revokePermission');
    });

    it('INV-01 holds across 5 independent record IDs', async function () {
      const recordIds = randomRecordIds(5);

      for (const recordId of recordIds) {
        await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);
        await medConsent.grantPermission(recordId, providerA.address, ONE_HOUR);
        await medConsent.revokePermission(recordId, providerA.address);

        const tx  = await medConsent.checkPermission(recordId, providerA.address);
        const r   = await tx.wait();
        const log = r.logs.find(l => l.fragment?.name === 'AccessLogged');

        expect(log.args.allowed).to.equal(false,
          `INV-01 VIOLATED for recordId=${recordId}`);
      }
    });

    it('INV-01 holds for multiple providers on same record', async function () {
      const recordId = 'inv01_multi_provider';
      await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);

      // Grant both providers
      await medConsent.grantPermission(recordId, providerA.address, ONE_HOUR);
      await medConsent.grantPermission(recordId, providerB.address, ONE_HOUR);

      // Revoke only providerA
      await medConsent.revokePermission(recordId, providerA.address);

      // providerA must be denied
      const txA  = await medConsent.checkPermission(recordId, providerA.address);
      const rA   = await txA.wait();
      const logA = rA.logs.find(l => l.fragment?.name === 'AccessLogged');
      expect(logA.args.allowed).to.equal(false,
        'INV-01 VIOLATED: revoked providerA still has access');

      // providerB must still be granted (revocation is per-provider)
      const txB  = await medConsent.checkPermission(recordId, providerB.address);
      const rB   = await txB.wait();
      const logB = rB.logs.find(l => l.fragment?.name === 'AccessLogged');
      expect(logB.args.allowed).to.equal(true,
        'Revocation of providerA must not affect providerB');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INV-02: no_access_without_grant
  //
  // Property: ∀ recordId, provider:
  //   ¬grantPermission(recordId, provider) ⟹ checkPermission(recordId, provider) = false
  //
  // Tested for unknown providers and unknown records.
  // ══════════════════════════════════════════════════════════════════════════
  describe('INV-02: no_access_without_grant', function () {
    it('checkPermission returns false for provider who was never granted', async function () {
      const recordId = 'inv02_rec_001';
      await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);

      // stranger was never granted
      const tx  = await medConsent.checkPermission(recordId, stranger.address);
      const r   = await tx.wait();
      const log = r.logs.find(l => l.fragment?.name === 'AccessLogged');

      expect(log.args.allowed).to.equal(false,
        'INV-02 VIOLATED: provider without grant has access');
    });

    it('checkPermission returns false for unknown record ID', async function () {
      const unknownRecord = 'inv02_unknown_record_xyz';

      // No addRecord call — record does not exist
      const tx  = await medConsent.checkPermission(unknownRecord, providerA.address);
      const r   = await tx.wait();
      const log = r.logs.find(l => l.fragment?.name === 'AccessLogged');

      expect(log.args.allowed).to.equal(false,
        'INV-02 VIOLATED: access granted for non-existent record');
    });

    it('INV-02 holds across 5 random unknown providers', async function () {
      const recordId = 'inv02_multi_unknown';
      await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);
      await medConsent.grantPermission(recordId, providerA.address, ONE_HOUR);

      // Test 5 random wallets that were never granted
      const unknownProviders = Array.from(
        { length: 5 }, () => ethers.Wallet.createRandom().address
      );

      for (const addr of unknownProviders) {
        const tx  = await medConsent.checkPermission(recordId, addr);
        const r   = await tx.wait();
        const log = r.logs.find(l => l.fragment?.name === 'AccessLogged');
        expect(log.args.allowed).to.equal(false,
          `INV-02 VIOLATED: unknown provider ${addr} has access`);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INV-03: audit_completeness
  //
  // Property: ∀ call to checkPermission():
  //   exactly one AccessLogged event is emitted,
  //   on BOTH the allow path AND the deny path.
  //
  // This is the structural property that yields 100% audit completeness.
  // ══════════════════════════════════════════════════════════════════════════
  describe('INV-03: audit_completeness', function () {
    it('exactly one AccessLogged event on the allow path', async function () {
      const recordId = 'inv03_allow';
      await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);
      await medConsent.grantPermission(recordId, providerA.address, ONE_HOUR);

      const tx = await medConsent.checkPermission(recordId, providerA.address);
      const r  = await tx.wait();

      const accessLogs = r.logs.filter(l => l.fragment?.name === 'AccessLogged');
      expect(accessLogs.length).to.equal(1,
        'INV-03 VIOLATED: allow path did not emit exactly 1 AccessLogged');
      expect(accessLogs[0].args.allowed).to.equal(true);
    });

    it('exactly one AccessLogged event on the deny path (revoked)', async function () {
      const recordId = 'inv03_deny_revoked';
      await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);
      await medConsent.grantPermission(recordId, providerA.address, ONE_HOUR);
      await medConsent.revokePermission(recordId, providerA.address);

      const tx = await medConsent.checkPermission(recordId, providerA.address);
      const r  = await tx.wait();

      const accessLogs = r.logs.filter(l => l.fragment?.name === 'AccessLogged');
      expect(accessLogs.length).to.equal(1,
        'INV-03 VIOLATED: deny path (revoked) did not emit exactly 1 AccessLogged');
      expect(accessLogs[0].args.allowed).to.equal(false);
    });

    it('exactly one AccessLogged event on the deny path (no grant)', async function () {
      const recordId = 'inv03_deny_no_grant';
      await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);

      const tx = await medConsent.checkPermission(recordId, stranger.address);
      const r  = await tx.wait();

      const accessLogs = r.logs.filter(l => l.fragment?.name === 'AccessLogged');
      expect(accessLogs.length).to.equal(1,
        'INV-03 VIOLATED: deny path (no grant) did not emit exactly 1 AccessLogged');
      expect(accessLogs[0].args.allowed).to.equal(false);
    });

    it('INV-03 holds across full grant-check-revoke-check cycle', async function () {
      const recordId = 'inv03_full_cycle';
      await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);
      await medConsent.grantPermission(recordId, providerA.address, ONE_HOUR);

      // check (allowed)
      const tx1  = await medConsent.checkPermission(recordId, providerA.address);
      const r1   = await tx1.wait();
      const logs1 = r1.logs.filter(l => l.fragment?.name === 'AccessLogged');
      expect(logs1.length).to.equal(1, 'INV-03: check(allowed) must emit exactly 1 event');
      expect(logs1[0].args.allowed).to.equal(true);

      await medConsent.revokePermission(recordId, providerA.address);

      // check (denied)
      const tx2  = await medConsent.checkPermission(recordId, providerA.address);
      const r2   = await tx2.wait();
      const logs2 = r2.logs.filter(l => l.fragment?.name === 'AccessLogged');
      expect(logs2.length).to.equal(1, 'INV-03: check(denied) must emit exactly 1 event');
      expect(logs2[0].args.allowed).to.equal(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Summary assertion — all three invariants together
  // ══════════════════════════════════════════════════════════════════════════
  describe('Combined: all three invariants hold on a full CGP lifecycle', function () {
    it('INV-01 + INV-02 + INV-03 on a 3-provider scenario', async function () {
      const recordId = 'inv_combined_001';
      await medConsent.addRecord(recordId, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);

      // Grant A, not B, never C (stranger)
      await medConsent.grantPermission(recordId, providerA.address, ONE_HOUR);

      // INV-02: B was never granted
      const txB  = await medConsent.checkPermission(recordId, providerB.address);
      const rB   = await txB.wait();
      const logB = rB.logs.find(l => l.fragment?.name === 'AccessLogged');
      expect(logB.args.allowed).to.equal(false, 'INV-02: providerB never granted');
      expect(rB.logs.filter(l => l.fragment?.name === 'AccessLogged').length)
        .to.equal(1, 'INV-03: exactly 1 event');

      // INV-03: A is granted — exactly 1 event
      const txA1  = await medConsent.checkPermission(recordId, providerA.address);
      const rA1   = await txA1.wait();
      const logA1 = rA1.logs.find(l => l.fragment?.name === 'AccessLogged');
      expect(logA1.args.allowed).to.equal(true, 'providerA should be granted');
      expect(rA1.logs.filter(l => l.fragment?.name === 'AccessLogged').length)
        .to.equal(1, 'INV-03: exactly 1 event on allow path');

      // Revoke A
      await medConsent.revokePermission(recordId, providerA.address);

      // INV-01: A is now denied — exactly 1 event
      const txA2  = await medConsent.checkPermission(recordId, providerA.address);
      const rA2   = await txA2.wait();
      const logA2 = rA2.logs.find(l => l.fragment?.name === 'AccessLogged');
      expect(logA2.args.allowed).to.equal(false, 'INV-01: revoked providerA denied');
      expect(rA2.logs.filter(l => l.fragment?.name === 'AccessLogged').length)
        .to.equal(1, 'INV-03: exactly 1 event on deny path');
    });
  });
});