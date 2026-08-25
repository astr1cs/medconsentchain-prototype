// MedConsentChain - Hardhat test suite
// Tests the permission state machine: grant, check, revoke, deny

const { ethers } = require("hardhat");
const { expect }  = require("chai");

describe("MedConsent", function () {
  let medConsent;
  let patient, provider, stranger;

  const RECORD_ID    = "rec_001";
  const CONTENT_HASH = ethers.keccak256(ethers.toUtf8Bytes("patient_data"));
  const IPFS_PTR     = "ipfs://QmTestHash";
  const WRAPPED_KEY  = "AES_KEY_WRAPPED_WITH_PROVIDER_PUBKEY";
  const ONE_HOUR     = 3600;

  beforeEach(async function () {
    [patient, provider, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("MedConsent", patient);
    medConsent = await Factory.deploy();
    await medConsent.waitForDeployment();
  });

  // ----------------------------------------------------------------
  // addRecord
  // ----------------------------------------------------------------
  describe("addRecord", function () {
    it("allows patient to add a record and emits RecordAdded", async function () {
      await expect(
        medConsent.addRecord(RECORD_ID, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY)
      ).to.emit(medConsent, "RecordAdded");
    });

    it("reverts when called by non-patient", async function () {
      await expect(
        medConsent.connect(provider)
          .addRecord(RECORD_ID, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY)
      ).to.be.revertedWith("Only patient can call this");
    });

    it("stores record retrievable via getRecord", async function () {
      await medConsent.addRecord(RECORD_ID, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);
      const [hash, ptr] = await medConsent.getRecord(RECORD_ID);
      expect(hash).to.equal(CONTENT_HASH);
      expect(ptr).to.equal(IPFS_PTR);
    });
  });

  // ----------------------------------------------------------------
  // grantPermission
  // ----------------------------------------------------------------
  describe("grantPermission", function () {
    it("emits PermissionGranted and AccessLogged(true) on checkPermission", async function () {
      await medConsent.addRecord(RECORD_ID, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);
      await expect(
        medConsent.grantPermission(RECORD_ID, provider.address, ONE_HOUR)
      ).to.emit(medConsent, "PermissionGranted");

      await expect(
        medConsent.checkPermission(RECORD_ID, provider.address)
      ).to.emit(medConsent, "AccessLogged");
    });

    it("reverts when called by non-patient", async function () {
      await expect(
        medConsent.connect(stranger)
          .grantPermission(RECORD_ID, provider.address, ONE_HOUR)
      ).to.be.revertedWith("Only patient can call this");
    });
  });

  // ----------------------------------------------------------------
  // revokePermission
  // ----------------------------------------------------------------
  describe("revokePermission", function () {
    beforeEach(async function () {
      await medConsent.addRecord(RECORD_ID, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);
      await medConsent.grantPermission(RECORD_ID, provider.address, ONE_HOUR);
    });

    it("emits PermissionRevoked", async function () {
      await expect(
        medConsent.revokePermission(RECORD_ID, provider.address)
      ).to.emit(medConsent, "PermissionRevoked");
    });

    it("causes checkPermission to emit AccessLogged after revocation", async function () {
      await medConsent.revokePermission(RECORD_ID, provider.address);
      // After revocation, AccessLogged should be emitted (allowed=false)
      await expect(
        medConsent.checkPermission(RECORD_ID, provider.address)
      ).to.emit(medConsent, "AccessLogged");
    });

    it("reverts revoking a non-existent permission", async function () {
      await expect(
        medConsent.revokePermission(RECORD_ID, stranger.address)
      ).to.be.revertedWith("Permission does not exist");
    });

    it("reverts when called by non-patient", async function () {
      await expect(
        medConsent.connect(provider)
          .revokePermission(RECORD_ID, provider.address)
      ).to.be.revertedWith("Only patient can call this");
    });
  });

  // ----------------------------------------------------------------
  // Audit completeness: exactly one event per operation (RQ2)
  // ----------------------------------------------------------------
  describe("Audit completeness (RQ2)", function () {
    it("produces exactly one event per operation across grant/check/revoke cycle", async function () {
      await medConsent.addRecord(RECORD_ID, CONTENT_HASH, IPFS_PTR, WRAPPED_KEY);

      const tx1 = await medConsent.grantPermission(RECORD_ID, provider.address, ONE_HOUR);
      const r1  = await tx1.wait();
      expect(r1.logs.length).to.equal(1, "grantPermission: expected 1 event");

      const tx2 = await medConsent.checkPermission(RECORD_ID, provider.address);
      const r2  = await tx2.wait();
      expect(r2.logs.length).to.equal(1, "checkPermission (allowed): expected 1 event");

      const tx3 = await medConsent.revokePermission(RECORD_ID, provider.address);
      const r3  = await tx3.wait();
      expect(r3.logs.length).to.equal(1, "revokePermission: expected 1 event");

      const tx4 = await medConsent.checkPermission(RECORD_ID, provider.address);
      const r4  = await tx4.wait();
      expect(r4.logs.length).to.equal(1, "checkPermission (denied): expected 1 event");
    });
  });
});
