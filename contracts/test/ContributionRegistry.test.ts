import { expect } from 'chai'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { ContributionRegistry } from '../typechain-types'

const SIGNAL_SOURCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SIGNAL_SOURCE_ROLE'))
const ADMIN_ROLE          = ethers.keccak256(ethers.toUtf8Bytes('ADMIN_ROLE'))
const ZERO_HASH           = ethers.ZeroHash

enum SignalType {
  ONCHAIN_TRANSACTION    = 0,
  GOVERNANCE_VOTE        = 1,
  LIQUIDITY_PROVISION    = 2,
  CONTRACT_DEPLOYMENT    = 3,
  PROTOCOL_INTERACTION   = 4,
  CUSTOM                 = 5,
}

describe('ContributionRegistry', () => {
  async function deployFixture() {
    const [deployer, admin, source, agent, alice, bob] = await ethers.getSigners()

    const ContributionRegistry = await ethers.getContractFactory('ContributionRegistry')
    const registry = (await ContributionRegistry.deploy(admin.address)) as ContributionRegistry
    await registry.waitForDeployment()

    // Grant signal source role to source and agent
    await registry.connect(admin).addSignalSource(source.address)
    await registry.connect(admin).addSignalSource(agent.address)

    const DATA_HASH = ethers.keccak256(ethers.toUtf8Bytes('tx:0xabc123'))

    return { registry, deployer, admin, source, agent, alice, bob, DATA_HASH }
  }

  describe('Deployment', () => {
    it('grants ADMIN_ROLE to admin', async () => {
      const { registry, admin } = await loadFixture(deployFixture)
      expect(await registry.hasRole(ADMIN_ROLE, admin.address)).to.be.true
    })

    it('starts with zero signals', async () => {
      const { registry } = await loadFixture(deployFixture)
      expect(await registry.signalCount()).to.equal(0n)
    })
  })

  describe('registerSignal', () => {
    it('source can register a signal', async () => {
      const { registry, source, alice, DATA_HASH } = await loadFixture(deployFixture)
      await registry.connect(source).registerSignal(alice.address, SignalType.ONCHAIN_TRANSACTION, 7500n, DATA_HASH)
      expect(await registry.signalCount()).to.equal(1n)
    })

    it('emits SignalRegistered event', async () => {
      const { registry, source, alice, DATA_HASH } = await loadFixture(deployFixture)
      await expect(
        registry.connect(source).registerSignal(alice.address, SignalType.GOVERNANCE_VOTE, 8000n, DATA_HASH)
      )
        .to.emit(registry, 'SignalRegistered')
        .withArgs(0n, alice.address, SignalType.GOVERNANCE_VOTE, 8000n, DATA_HASH, source.address)
    })

    it('stores signal with correct fields', async () => {
      const { registry, source, alice, DATA_HASH } = await loadFixture(deployFixture)
      await registry.connect(source).registerSignal(alice.address, SignalType.LIQUIDITY_PROVISION, 9000n, DATA_HASH)
      const signal = await registry.signals(0)

      expect(signal.contributor).to.equal(alice.address)
      expect(signal.signalType).to.equal(SignalType.LIQUIDITY_PROVISION)
      expect(signal.weight).to.equal(9000n)
      expect(signal.dataHash).to.equal(DATA_HASH)
      expect(signal.source).to.equal(source.address)
      expect(signal.processed).to.be.false
    })

    it('rejects non-source caller', async () => {
      const { registry, alice, DATA_HASH } = await loadFixture(deployFixture)
      await expect(
        registry.connect(alice).registerSignal(alice.address, SignalType.CUSTOM, 5000n, DATA_HASH)
      ).to.be.reverted
    })

    it('rejects zero contributor address', async () => {
      const { registry, source, DATA_HASH } = await loadFixture(deployFixture)
      await expect(
        registry.connect(source).registerSignal(ethers.ZeroAddress, SignalType.CUSTOM, 5000n, DATA_HASH)
      ).to.be.revertedWithCustomError(registry, 'InvalidContributor')
    })

    it('rejects weight > 10000', async () => {
      const { registry, source, alice, DATA_HASH } = await loadFixture(deployFixture)
      await expect(
        registry.connect(source).registerSignal(alice.address, SignalType.CUSTOM, 10001n, DATA_HASH)
      ).to.be.revertedWithCustomError(registry, 'InvalidWeight')
    })

    it('tracks contributor signals', async () => {
      const { registry, source, alice, DATA_HASH } = await loadFixture(deployFixture)
      await registry.connect(source).registerSignal(alice.address, SignalType.CUSTOM, 5000n, DATA_HASH)
      await registry.connect(source).registerSignal(alice.address, SignalType.GOVERNANCE_VOTE, 7000n, DATA_HASH)

      const ids = await registry.getContributorSignals(alice.address)
      expect(ids.length).to.equal(2)
      expect(ids[0]).to.equal(0n)
      expect(ids[1]).to.equal(1n)
    })
  })

  describe('registerSignalBatch', () => {
    it('registers multiple signals at once', async () => {
      const { registry, source, alice, bob, DATA_HASH } = await loadFixture(deployFixture)
      await registry.connect(source).registerSignalBatch(
        [alice.address, bob.address],
        [SignalType.ONCHAIN_TRANSACTION, SignalType.GOVERNANCE_VOTE],
        [7000n, 8000n],
        [DATA_HASH, DATA_HASH]
      )
      expect(await registry.signalCount()).to.equal(2n)
    })

    it('rejects mismatched lengths', async () => {
      const { registry, source, alice, DATA_HASH } = await loadFixture(deployFixture)
      await expect(
        registry.connect(source).registerSignalBatch(
          [alice.address],
          [SignalType.CUSTOM, SignalType.GOVERNANCE_VOTE], // wrong length
          [7000n],
          [DATA_HASH]
        )
      ).to.be.revertedWith('ContributionRegistry: length mismatch')
    })
  })

  describe('markProcessed', () => {
    it('agent can mark signals as processed', async () => {
      const { registry, source, agent, alice, DATA_HASH } = await loadFixture(deployFixture)
      await registry.connect(source).registerSignal(alice.address, SignalType.CUSTOM, 5000n, DATA_HASH)
      await registry.connect(agent).markProcessed([0n])

      const signal = await registry.signals(0)
      expect(signal.processed).to.be.true
    })

    it('emits SignalProcessed', async () => {
      const { registry, source, agent, alice, DATA_HASH } = await loadFixture(deployFixture)
      await registry.connect(source).registerSignal(alice.address, SignalType.CUSTOM, 5000n, DATA_HASH)
      await expect(registry.connect(agent).markProcessed([0n]))
        .to.emit(registry, 'SignalProcessed')
        .withArgs(0n, agent.address)
    })

    it('rejects double-processing', async () => {
      const { registry, source, agent, alice, DATA_HASH } = await loadFixture(deployFixture)
      await registry.connect(source).registerSignal(alice.address, SignalType.CUSTOM, 5000n, DATA_HASH)
      await registry.connect(agent).markProcessed([0n])
      await expect(registry.connect(agent).markProcessed([0n]))
        .to.be.revertedWithCustomError(registry, 'AlreadyProcessed')
    })
  })

  describe('getPendingSignals', () => {
    it('returns unprocessed signals', async () => {
      const { registry, source, agent, alice, bob, DATA_HASH } = await loadFixture(deployFixture)
      await registry.connect(source).registerSignal(alice.address, SignalType.CUSTOM, 5000n, DATA_HASH)
      await registry.connect(source).registerSignal(bob.address, SignalType.GOVERNANCE_VOTE, 7000n, DATA_HASH)
      await registry.connect(agent).markProcessed([0n])

      const pending = await registry.getPendingSignals(10n)
      expect(pending.length).to.equal(1)
      expect(pending[0].contributor).to.equal(bob.address)
    })

    it('returns empty array when all processed', async () => {
      const { registry, source, agent, alice, DATA_HASH } = await loadFixture(deployFixture)
      await registry.connect(source).registerSignal(alice.address, SignalType.CUSTOM, 5000n, DATA_HASH)
      await registry.connect(agent).markProcessed([0n])

      const pending = await registry.getPendingSignals(10n)
      expect(pending.length).to.equal(0)
    })
  })

  describe('Admin', () => {
    it('admin can add and remove signal sources', async () => {
      const { registry, admin, alice } = await loadFixture(deployFixture)
      await registry.connect(admin).addSignalSource(alice.address)
      expect(await registry.hasRole(SIGNAL_SOURCE_ROLE, alice.address)).to.be.true

      await registry.connect(admin).removeSignalSource(alice.address)
      expect(await registry.hasRole(SIGNAL_SOURCE_ROLE, alice.address)).to.be.false
    })

    it('non-admin cannot add signal source', async () => {
      const { registry, alice } = await loadFixture(deployFixture)
      await expect(
        registry.connect(alice).addSignalSource(alice.address)
      ).to.be.reverted
    })
  })
})