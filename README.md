# VALOR — Autonomous Value Allocation & Reward Oracle

> An on-chain AI agent that autonomously manages a reward treasury, scores contributor activity, and distributes USD₮ tips based on verifiable economic logic — without human intervention.

**Hackathon Galáctica: WDK Edition 1 — Tipping Bot Track**

---

## What is VALOR?

VALOR is not a tipping bot. It is **programmable value distribution infrastructure**.

Any DAO, protocol, or open-source project can deploy VALOR to autonomously reward contributors — with no admin, no multisig committee, and no human bottleneck. The agent holds its own self-custodial treasury via WDK, makes its own allocation decisions, and settles every tip on-chain with full cryptographic auditability.

```
→ Builders define the rules
→ Agent scores contributions
→ Value settles on-chain
→ Every decision is provable
```

---

## Live Deployment (Sepolia)

| Contract | Address |
|---|---|
| TipVault | `0xF087C088436A293a94700bfbE1783FD99b1a5d98` |
| ContributionRegistry | `0x36Ad158fE38a2eeD2CA76Ff0EA6B1bEF80212279` |
| USDT Token | `0xd077A400968890Eacc75cdc901F0356c943e4fDb` |
| Agent Wallet | `0xe85f7E7C4A95857eaFD334FFb1fa1337e0e2b2D2` |
| Network | Ethereum Sepolia (chainId: 11155111) |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              SIGNAL LAYER                           │
│   ContributionRegistry.sol                         │
│   Any permissioned source registers on-chain       │
│   contribution signals with weight + data hash     │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              AGENT BRAIN                            │
│   ValorAgent (TypeScript + WDK)                    │
│                                                     │
│   ┌─────────────────┐  ┌────────────────────────┐  │
│   │  ScoringEngine  │  │   TreasuryManager      │  │
│   │                 │  │                        │  │
│   │  • Type weights │  │  • HEALTHY / LOW /     │  │
│   │  • Recency decay│  │    CRITICAL / PAUSED   │  │
│   │  • Diminishing  │  │  • Dynamic tip sizing  │  │
│   │    returns      │  │  • Runway protection   │  │
│   └────────┬────────┘  └───────────┬────────────┘  │
│            └──────────┬────────────┘               │
│                       │                             │
│            ┌──────────▼──────────┐                 │
│            │    ValorWallet      │                 │
│            │    (WDK — EVM)      │                 │
│            │  Self-custodial     │                 │
│            │  BIP-44 derived     │                 │
│            └──────────┬──────────┘                 │
└───────────────────────┼─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│              EXECUTION LAYER                        │
│   TipVault.sol                                     │
│                                                     │
│   • AGENT_ROLE only executes tips                  │
│   • epochBudget: max spend per 24h                 │
│   • maxTipAmount: per-tip ceiling                  │
│   • minTreasuryReserve: always keeps a buffer      │
│   • recipientCooldown: anti-spam per address       │
│   • reasoningHash: keccak256(decision log)         │
│     anchors every tip to off-chain reasoning       │
└─────────────────────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│              TRANSPARENCY LAYER                     │
│   React Dashboard                                  │
│   • Live treasury balance + epoch budget bar       │
│   • Full tip feed with contribution scores         │
│   • Expandable reasoning hash per tip              │
└─────────────────────────────────────────────────────┘
```

---

## How It Works

### 1. Signal Registration
Any address with `SIGNAL_SOURCE_ROLE` on `ContributionRegistry` can register contribution signals:

```solidity
registry.registerSignal(
    contributor,      // who contributed
    SignalType.GOVERNANCE_VOTE,
    weight,           // 0–10000 basis points
    dataHash          // keccak256 of off-chain evidence
)
```

Signal types: `ONCHAIN_TRANSACTION`, `GOVERNANCE_VOTE`, `LIQUIDITY_PROVISION`, `CONTRACT_DEPLOYMENT`, `PROTOCOL_INTERACTION`, `CUSTOM`

### 2. Agent Scoring Loop
Every epoch the agent:
1. Fetches pending signals from `ContributionRegistry`
2. Checks vault health via `TreasuryManager`
3. Groups signals by contributor
4. Calculates weighted composite scores with:
   - **Type multipliers** — governance votes weighted higher than generic txns
   - **Recency decay** — signals older than 7 days get 50% weight
   - **Diminishing returns** — log-scale decay for repeated same-type signals
5. Maps score → tip amount (dynamic, bounded by treasury health)
6. Builds a `DecisionLog` JSON for each tip
7. Computes `keccak256(decisionLog)` as the `reasoningHash`

### 3. On-Chain Settlement
```solidity
tipVault.executeTip(
    recipient,
    amount,           // USDT base units
    reasoningHash,    // proof of decision
    contributionScore // 0–10000
)
```

The vault verifies all constraints then transfers USD₮ and emits:
```solidity
event TipExecuted(
    uint256 indexed tipId,
    address indexed recipient,
    uint256 amount,
    bytes32 reasoningHash,  // ← cryptographic audit trail
    uint256 contributionScore,
    uint256 timestamp
)
```

### 4. Verification
Anyone can verify a tip decision:
1. Get `reasoningHash` from the `TipExecuted` event
2. Retrieve the agent's `DecisionLog` JSON (stored off-chain, IPFS or public endpoint)
3. `keccak256(JSON.stringify(log, sortedKeys)) === reasoningHash` ✓

---

## Economic Safety Model

| Constraint | Purpose |
|---|---|
| `maxTipAmount` | Caps single tip — limits blast radius of any bad decision |
| `epochBudget` | Daily spend ceiling — agent can never drain the vault in one epoch |
| `minTreasuryReserve` | Vault always keeps a buffer — agent cannot zero itself out |
| `recipientCooldown` | Anti-spam — same address can only receive one tip per cooldown period |
| `HEALTHY / LOW / CRITICAL` | Treasury health tiers — agent scales tip amounts down as balance drops |
| `AGENT_ROLE` separation | Agent can tip but cannot withdraw or change limits |
| `ADMIN_ROLE` separation | Admin can configure and pause but cannot directly move treasury funds to themselves |

---

## Repository Structure

```
valor/
├── contracts/
│   ├── src/
│   │   ├── TipVault.sol              # Treasury + tip execution
│   │   ├── ContributionRegistry.sol  # Signal registration
│   │   └── MockUSDT.sol              # Test token
│   ├── test/
│   │   ├── TipVault.test.ts          # 30+ test cases
│   │   └── ContributionRegistry.test.ts
│   └── script/
│       └── Deploy.s.ts
│
├── agent/
│   ├── src/
│   │   ├── agent/
│   │   │   ├── ValorAgent.ts         # Main autonomous loop
│   │   │   └── types.ts
│   │   ├── wallet/
│   │   │   └── ValorWallet.ts        # WDK integration
│   │   ├── scoring/
│   │   │   └── ScoringEngine.ts      # Weighted scoring + reasoning hash
│   │   └── treasury/
│   │       └── TreasuryManager.ts    # Health tiers + spend gating
│   └── tests/
│       ├── scoring.test.ts
│       └── treasury.test.ts
│
├── dashboard/
│   └── src/
│       ├── App.tsx                   # Live transparency UI
│       └── hooks/useVaultData.ts     # On-chain data polling
│
├── shared/
│   └── src/index.ts                  # Shared ABIs + types
│
└── generate-wallet.mjs               # WDK agent wallet generator
```

---

## Quick Start

### Prerequisites
- Node.js ≥ 20
- Sepolia ETH for gas ([faucet](https://sepoliafaucet.com))
- Alchemy API key ([free](https://alchemy.com))

### 1. Install
```bash
git clone https://github.com/YOUR_HANDLE/valor
cd valor
npm install
```

### 2. Generate agent wallet
```bash
node generate-wallet.mjs
```
Copy the seed phrase and address into your `.env` files.

### 3. Configure
```bash
cp contracts/.env.example contracts/.env
cp agent/.env.example agent/.env
cp dashboard/.env.example dashboard/.env
```

Fill in your RPC URL, private key, and agent wallet address.

### 4. Deploy contracts
```bash
cd contracts
npm run deploy:sepolia
```

### 5. Fund the vault
```bash
cd agent
node --input-type=module -e "
import 'dotenv/config';
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const usdt = new ethers.Contract(process.env.USDT_ADDRESS, ['function approve(address,uint256) external returns (bool)', 'function balanceOf(address) external view returns (uint256)'], deployer);
const balance = await usdt.balanceOf(deployer.address);
await (await usdt.approve(process.env.VAULT_ADDRESS, balance)).wait();
const vault = new ethers.Contract(process.env.VAULT_ADDRESS, ['function deposit(uint256) external'], deployer);
await (await vault.deposit(balance)).wait();
console.log('Vault funded:', (Number(balance)/1e6).toFixed(2), 'USDT');
"
```

### 6. Start agent + dashboard
```bash
# Terminal 1
cd agent && npm run start

# Terminal 2
cd dashboard && npm run dev
```

### 7. Register test signals
```bash
cd agent
node --input-type=module -e "
import 'dotenv/config';
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const registry = new ethers.Contract(process.env.REGISTRY_ADDRESS, [
  'function addSignalSource(address) external',
  'function registerSignalBatch(address[],uint8[],uint256[],bytes32[]) external'
], deployer);
await (await registry.addSignalSource(deployer.address)).wait();
await (await registry.registerSignalBatch(
  ['0xADDRESS_1', '0xADDRESS_2'],
  [1, 0],
  [9000n, 7500n],
  [ethers.keccak256(ethers.toUtf8Bytes('vote:prop-1')), ethers.keccak256(ethers.toUtf8Bytes('tx:0xabc'))]
)).wait();
console.log('Signals registered');
"
```

### 8. Run tests
```bash
cd contracts && npm test   # 58 passing
cd agent && npm test       # 19 passing
```

---

## Judging Criteria Alignment

| Criteria | How VALOR delivers |
|---|---|
| **Technical correctness** | Clean WDK integration, Hardhat test suite (58 passing), end-to-end on-chain flows, TypeScript throughout |
| **Degree of agent autonomy** | Zero human triggers between loops. Agent reads chain state, scores, decides, executes, and marks processed — fully autonomous |
| **Economic soundness** | Epoch budgets, per-tip ceilings, treasury reserve floors, health-tier spend scaling, cooldowns — multiple independent safety layers |
| **Real-world applicability** | Drop-in for any DAO or protocol. Signal sources are permissioned but open. Vault is fundable by anyone. Dashboard is public |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.24, OpenZeppelin 5, Hardhat |
| Agent Runtime | TypeScript, Node.js 20, WDK (`@tetherto/wdk`), ethers v6 |
| Agent Testing | Vitest |
| Dashboard | React 18, Vite, ethers v6 |
| Network | Ethereum Sepolia testnet |
| Wallet | WDK EVM module — BIP-44 self-custodial, stateless |

---

## License

MIT