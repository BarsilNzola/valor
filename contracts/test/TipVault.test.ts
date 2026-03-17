import { expect } from 'chai'
import { ethers } from 'hardhat'
import { time, loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { TipVault, MockUSDT } from '../typechain-types'
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers'

const USDT = (n: number) => BigInt(n) * 1_000_000n  // 6 decimals
const AGENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('AGENT_ROLE'))
const ADMIN_ROLE  = ethers.keccak256(ethers.toUtf8Bytes('ADMIN_ROLE'))

describe('TipVault', () => {
  // ─── Fixture ─────────────────────────────────────────────────────────────
  async function deployFixture() {
    const [deployer, agent, admin, alice, bob, carol] =
      await ethers.getSigners()

    const MockUSDT = await ethers.getContractFactory('MockUSDT')
    const usdt = (await MockUSDT.deploy(deployer.address)) as MockUSDT
    await usdt.waitForDeployment()

    const TipVault = await ethers.getContractFactory('TipVault')
    const vault = (await TipVault.deploy(
      await usdt.getAddress(),
      agent.address,
      admin.address,
      USDT(10),        // maxTipAmount  = 10 USDT
      USDT(100),       // epochBudget   = 100 USDT
      3600n,           // epochDuration = 1 hour
      USDT(50),        // minReserve    = 50 USDT
      300n             // recipientCooldown = 5 min
    )) as TipVault
    await vault.waitForDeployment()

    // Fund the vault with 1,000 USDT
    await usdt.connect(deployer).approve(await vault.getAddress(), USDT(1000))
    await vault.connect(deployer).deposit(USDT(1000))

    const REASONING = ethers.keccak256(ethers.toUtf8Bytes('{"score":8500,"signals":["tx-1"]}'))

    return { vault, usdt, deployer, agent, admin, alice, bob, carol, REASONING }
  }

  // ─── Deployment ──────────────────────────────────────────────────────────
  describe('Deployment', () => {
    it('sets correct roles', async () => {
      const { vault, agent, admin } = await loadFixture(deployFixture)
      expect(await vault.hasRole(AGENT_ROLE, agent.address)).to.be.true
      expect(await vault.hasRole(ADMIN_ROLE, admin.address)).to.be.true
    })

    it('stores correct config', async () => {
      const { vault } = await loadFixture(deployFixture)
      expect(await vault.maxTipAmount()).to.equal(USDT(10))
      expect(await vault.epochBudget()).to.equal(USDT(100))
      expect(await vault.epochDuration()).to.equal(3600n)
      expect(await vault.minTreasuryReserve()).to.equal(USDT(50))
      expect(await vault.recipientCooldown()).to.equal(300n)
    })

    it('has 1000 USDT funded', async () => {
      const { vault } = await loadFixture(deployFixture)
      expect(await vault.treasuryBalance()).to.equal(USDT(1000))
    })

    it('reverts with zero USDT address', async () => {
      const [d, agent, admin] = await ethers.getSigners()
      const TipVault = await ethers.getContractFactory('TipVault')
      await expect(
        TipVault.deploy(ethers.ZeroAddress, agent.address, admin.address, USDT(10), USDT(100), 3600n, USDT(50), 300n)
      ).to.be.revertedWith('TipVault: zero USDT')
    })

    it('reverts when epoch < 1 hour', async () => {
      const [d, agent, admin] = await ethers.getSigners()
      const MockUSDT = await ethers.getContractFactory('MockUSDT')
      const usdt = await MockUSDT.deploy(d.address)
      const TipVault = await ethers.getContractFactory('TipVault')
      await expect(
        TipVault.deploy(await usdt.getAddress(), agent.address, admin.address, USDT(10), USDT(100), 100n, USDT(50), 300n)
      ).to.be.revertedWith('TipVault: epoch<1h')
    })
  })

  // ─── executeTip ───────────────────────────────────────────────────────────
  describe('executeTip', () => {
    it('agent can send a tip', async () => {
      const { vault, usdt, agent, alice, REASONING } = await loadFixture(deployFixture)

      const before = await usdt.balanceOf(alice.address)
      await vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 8500n)
      const after  = await usdt.balanceOf(alice.address)

      expect(after - before).to.equal(USDT(5))
    })

    it('emits TipExecuted with correct fields', async () => {
        const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
        const tx = await vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 8500n)
        const receipt = await tx.wait()
        const block = await ethers.provider.getBlock(receipt!.blockNumber)
        const blockTs = BigInt(block!.timestamp)
      
        await expect(tx)
          .to.emit(vault, 'TipExecuted')
          .withArgs(0n, alice.address, USDT(5), REASONING, 8500n, blockTs)
    })

    it('stores tip record', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      await vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 8500n)
      const record = await vault.tipRecords(0)

      expect(record.recipient).to.equal(alice.address)
      expect(record.amount).to.equal(USDT(5))
      expect(record.reasoningHash).to.equal(REASONING)
      expect(record.contributionScore).to.equal(8500n)
    })

    it('increments totalTipCount and totalTipsDistributed', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      await vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 8500n)
      expect(await vault.totalTipCount()).to.equal(1n)
      expect(await vault.totalTipsDistributed()).to.equal(USDT(5))
    })

    it('rejects non-agent caller', async () => {
      const { vault, alice, bob, REASONING } = await loadFixture(deployFixture)
      await expect(
        vault.connect(alice).executeTip(bob.address, USDT(1), REASONING, 5000n)
      ).to.be.reverted
    })

    it('rejects zero address recipient', async () => {
      const { vault, agent, REASONING } = await loadFixture(deployFixture)
      await expect(
        vault.connect(agent).executeTip(ethers.ZeroAddress, USDT(1), REASONING, 5000n)
      ).to.be.revertedWithCustomError(vault, 'RecipientIsZeroAddress')
    })

    it('rejects zero amount', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      await expect(
        vault.connect(agent).executeTip(alice.address, 0n, REASONING, 5000n)
      ).to.be.revertedWithCustomError(vault, 'TipAmountZero')
    })

    it('rejects tip exceeding maxTipAmount', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      await expect(
        vault.connect(agent).executeTip(alice.address, USDT(11), REASONING, 5000n)
      ).to.be.revertedWithCustomError(vault, 'TipAmountExceedsMax')
    })

    it('enforces recipient cooldown', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      await vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 8500n)

      await expect(
        vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 8500n)
      ).to.be.revertedWithCustomError(vault, 'RecipientOnCooldown')
    })

    it('allows tip after cooldown expires', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      await vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 8500n)

      await time.increase(301) // past 300s cooldown

      await expect(
        vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 8500n)
      ).to.not.be.reverted
    })

    it('enforces epoch budget', async () => {
      const { vault, agent, alice, bob, carol, REASONING } = await loadFixture(deployFixture)
      // Send 100 USDT in 10x 10 USDT tips to different addresses
      const signers = await ethers.getSigners()

      for (let i = 0; i < 10; i++) {
        await vault.connect(agent).executeTip(signers[i + 5].address, USDT(10), REASONING, 5000n)
      }

      await expect(
        vault.connect(agent).executeTip(alice.address, USDT(1), REASONING, 5000n)
      ).to.be.revertedWithCustomError(vault, 'EpochBudgetExceeded')
    })

    it('resets epoch budget after epoch rolls', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      const signers = await ethers.getSigners()

      // Exhaust budget
      for (let i = 0; i < 10; i++) {
        await vault.connect(agent).executeTip(signers[i + 5].address, USDT(10), REASONING, 5000n)
      }

      await time.increase(3601) // roll epoch

      await expect(
        vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 5000n)
      ).to.not.be.reverted
    })

    it('rejects when reserve would be breached', async () => {
      const { vault, agent, admin, usdt, deployer, REASONING } = await loadFixture(deployFixture)
      const signers = await ethers.getSigners()

      // Withdraw most funds leaving just below tip+reserve
      // Treasury: 1000. Reserve: 50. Balance needed: 50 + 10 = 60.
      // So drain to 59 USDT
      await vault.connect(admin).emergencyWithdraw(deployer.address, USDT(941))

      await expect(
        vault.connect(agent).executeTip(signers[5].address, USDT(10), REASONING, 5000n)
      ).to.be.revertedWithCustomError(vault, 'InsufficientTreasuryReserve')
    })

    it('rejects when paused', async () => {
      const { vault, agent, admin, alice, REASONING } = await loadFixture(deployFixture)
      await vault.connect(admin).pause()
      await expect(
        vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 5000n)
      ).to.be.revertedWithCustomError(vault, 'EnforcedPause')
    })
  })

  // ─── executeBatchTips ─────────────────────────────────────────────────────
  describe('executeBatchTips', () => {
    it('sends tips to all recipients', async () => {
      const { vault, usdt, agent, alice, bob, carol, REASONING } = await loadFixture(deployFixture)

      const recipients  = [alice.address, bob.address, carol.address]
      const amounts     = [USDT(3), USDT(4), USDT(5)]
      const hashes      = [REASONING, REASONING, REASONING]
      const scores      = [7000n, 8000n, 9000n]

      await vault.connect(agent).executeBatchTips(recipients, amounts, hashes, scores)

      expect(await usdt.balanceOf(alice.address)).to.equal(USDT(3))
      expect(await usdt.balanceOf(bob.address)).to.equal(USDT(4))
      expect(await usdt.balanceOf(carol.address)).to.equal(USDT(5))
    })

    it('reverts all if one recipient is on cooldown', async () => {
      const { vault, agent, alice, bob, REASONING } = await loadFixture(deployFixture)
      // Pre-tip alice to put her on cooldown
      await vault.connect(agent).executeTip(alice.address, USDT(1), REASONING, 5000n)

      await expect(
        vault.connect(agent).executeBatchTips(
          [bob.address, alice.address],
          [USDT(1), USDT(1)],
          [REASONING, REASONING],
          [5000n, 5000n]
        )
      ).to.be.revertedWithCustomError(vault, 'RecipientOnCooldown')
    })

    it('rejects empty batch', async () => {
      const { vault, agent } = await loadFixture(deployFixture)
      await expect(
        vault.connect(agent).executeBatchTips([], [], [], [])
      ).to.be.revertedWithCustomError(vault, 'BatchSizeInvalid')
    })

    it('rejects batch > 50', async () => {
        const { vault, agent, REASONING } = await loadFixture(deployFixture)
        const addrs  = Array(51).fill('0x0000000000000000000000000000000000000001')
        const amts   = Array(51).fill(USDT(1))
        const hashes = Array(51).fill(REASONING)
        const scores = Array(51).fill(5000n)
      
        await expect(
          vault.connect(agent).executeBatchTips(addrs, amts, hashes, scores)
        ).to.be.revertedWithCustomError(vault, 'BatchSizeInvalid')
    })

    it('rejects mismatched array lengths', async () => {
      const { vault, agent, alice, bob, REASONING } = await loadFixture(deployFixture)
      await expect(
        vault.connect(agent).executeBatchTips(
          [alice.address, bob.address],
          [USDT(1)],         // wrong length
          [REASONING, REASONING],
          [5000n, 5000n]
        )
      ).to.be.revertedWithCustomError(vault, 'ArrayLengthMismatch')
    })
  })

  // ─── Treasury ─────────────────────────────────────────────────────────────
  describe('Treasury', () => {
    it('anyone can deposit', async () => {
      const { vault, usdt, alice } = await loadFixture(deployFixture)
      await usdt.connect(alice).faucet(alice.address, USDT(100))
      await usdt.connect(alice).approve(await vault.getAddress(), USDT(100))
      await vault.connect(alice).deposit(USDT(100))
      expect(await vault.treasuryBalance()).to.equal(USDT(1100))
    })

    it('admin can emergency withdraw', async () => {
      const { vault, usdt, admin, alice } = await loadFixture(deployFixture)
      const before = await usdt.balanceOf(alice.address)
      await vault.connect(admin).emergencyWithdraw(alice.address, USDT(100))
      expect(await usdt.balanceOf(alice.address)).to.equal(before + USDT(100))
    })

    it('non-admin cannot emergency withdraw', async () => {
      const { vault, alice } = await loadFixture(deployFixture)
      await expect(
        vault.connect(alice).emergencyWithdraw(alice.address, USDT(100))
      ).to.be.reverted
    })
  })

  // ─── Admin Config ─────────────────────────────────────────────────────────
  describe('Admin Config', () => {
    it('admin can update limits', async () => {
      const { vault, admin } = await loadFixture(deployFixture)
      await vault.connect(admin).updateLimits(USDT(20), USDT(200), 7200n, USDT(100), 600n)
      expect(await vault.maxTipAmount()).to.equal(USDT(20))
      expect(await vault.epochBudget()).to.equal(USDT(200))
    })

    it('non-admin cannot update limits', async () => {
      const { vault, alice } = await loadFixture(deployFixture)
      await expect(
        vault.connect(alice).updateLimits(USDT(20), USDT(200), 7200n, USDT(100), 600n)
      ).to.be.reverted
    })

    it('admin can rotate agent', async () => {
      const { vault, admin, agent, alice } = await loadFixture(deployFixture)
      await vault.connect(admin).rotateAgent(agent.address, alice.address)
      expect(await vault.hasRole(AGENT_ROLE, alice.address)).to.be.true
      expect(await vault.hasRole(AGENT_ROLE, agent.address)).to.be.false
      expect(await vault.agentWallet()).to.equal(alice.address)
    })

    it('admin can pause and unpause', async () => {
      const { vault, admin } = await loadFixture(deployFixture)
      await vault.connect(admin).pause()
      expect(await vault.paused()).to.be.true
      await vault.connect(admin).unpause()
      expect(await vault.paused()).to.be.false
    })
  })

  // ─── View Functions ───────────────────────────────────────────────────────
  describe('View Functions', () => {
    it('canTip returns true for valid tip', async () => {
      const { vault, alice } = await loadFixture(deployFixture)
      const [ok, reason] = await vault.canTip(alice.address, USDT(5))
      expect(ok).to.be.true
      expect(reason).to.equal('ok')
    })

    it('canTip returns false when paused', async () => {
      const { vault, admin, alice } = await loadFixture(deployFixture)
      await vault.connect(admin).pause()
      const [ok, reason] = await vault.canTip(alice.address, USDT(5))
      expect(ok).to.be.false
      expect(reason).to.equal('paused')
    })

    it('canTip returns false for zero amount', async () => {
      const { vault, alice } = await loadFixture(deployFixture)
      const [ok, reason] = await vault.canTip(alice.address, 0n)
      expect(ok).to.be.false
      expect(reason).to.equal('zero amount')
    })

    it('getTipRecords paginates correctly', async () => {
      const { vault, agent, REASONING } = await loadFixture(deployFixture)
      const signers = await ethers.getSigners()

      for (let i = 0; i < 5; i++) {
        await vault.connect(agent).executeTip(signers[i + 5].address, USDT(1), REASONING, 5000n)
      }

      const page1 = await vault.getTipRecords(0, 3)
      const page2 = await vault.getTipRecords(3, 3)

      expect(page1.length).to.equal(3)
      expect(page2.length).to.equal(2)
      expect(page1[0].tipId).to.equal(0n)
      expect(page2[0].tipId).to.equal(3n)
    })

    it('getVaultState returns correct snapshot', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      await vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 8500n)

      const state = await vault.getVaultState()
      expect(state.balance).to.equal(USDT(995))
      expect(state.totalDistributed).to.equal(USDT(5))
      expect(state.tipCount).to.equal(1n)
      expect(state.isPaused).to.be.false
    })

    it('epochBudgetRemaining decreases after tips', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      await vault.connect(agent).executeTip(alice.address, USDT(10), REASONING, 5000n)
      expect(await vault.epochBudgetRemaining()).to.equal(USDT(90))
    })

    it('epochTimeRemaining is > 0 within epoch', async () => {
      const { vault } = await loadFixture(deployFixture)
      expect(await vault.epochTimeRemaining()).to.be.gt(0n)
    })

    it('epochBudgetRemaining returns full budget after epoch rolls', async () => {
      const { vault, agent, alice, REASONING } = await loadFixture(deployFixture)
      await vault.connect(agent).executeTip(alice.address, USDT(10), REASONING, 5000n)
      await time.increase(3601)
      expect(await vault.epochBudgetRemaining()).to.equal(USDT(100))
    })
  })

  // ─── Epoch Rolling ────────────────────────────────────────────────────────
  describe('Epoch Rolling', () => {
    it('emits EpochRolled event on first tip after epoch expires', async () => {
      const { vault, agent, alice, bob, REASONING } = await loadFixture(deployFixture)
      await vault.connect(agent).executeTip(alice.address, USDT(5), REASONING, 5000n)
      await time.increase(3601)

      await expect(
        vault.connect(agent).executeTip(bob.address, USDT(5), REASONING, 5000n)
      ).to.emit(vault, 'EpochRolled')
    })
  })
})