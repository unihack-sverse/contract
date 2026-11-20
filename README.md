# Sverse Contracts

Smart contracts for Sverse game items, Living Item deeds, primary sales,
secondary trading, and rewards on Avalanche C-Chain.

The current release targets Avalanche Fuji Testnet. It is not audited and must
not be used with real funds on mainnet.

## Architecture

```text
                         +----------------------+
Studio / Sverse -------->| SverseItems (ERC1155)|
                         +----------+-----------+
                                    |
                    mint            | ownership / royalty
                                    |
             +----------------------+----------------------+
             |                      |                      |
     +-------v-------+     +--------v---------+   +--------v-----------+
     | SverseStore   |     | SverseMarketplace|   | SverseDeedRegistry |
     | primary sales |     | secondary escrow |   | EIP-712 provenance |
     +-------+-------+     +--------+---------+   +--------------------+
             |                      |
             +----------+-----------+
                        |
                 +------v------+
                 |  MockSRV    |
                 | Fuji ERC20  |
                 +------+------+       +------------------+
                        +-------------->| SverseRewards    |
                                        | Merkle claims    |
                                        +------------------+
```

## Contracts

| Contract | Responsibility |
| --- | --- |
| `MockSRV.sol` | Fuji-only ERC-20 with 6 decimals and a rate-limited faucet. Never deploy this faucet token to mainnet. |
| `SverseItems.sol` | ERC-1155 catalog, studio/game ownership, limited supply, Living Items, ERC-2981 royalties, metadata freeze, mint/burn and transfer rules. |
| `SverseDeedRegistry.sol` | Append-only EIP-712 signed provenance records with nonce replay protection and optional Sverse witness signatures. |
| `SverseStore.sol` | Primary fixed-price sales, wallet limits, sale windows, protocol fee split and atomic item minting. |
| `SverseMarketplace.sol` | Fixed-price ERC-1155 escrow, cancellation, settlement, ERC-2981 royalty payment and protocol fees. |
| `SverseRewards.sol` | Funded reward epochs, Merkle proof claims, bitmap replay protection and expired-fund recovery. |

### Item model

Standard items use one token ID per definition and may have a supply greater
than one. Every Living Item mint receives a new token ID with a total supply of
one, while `definitionOf(tokenId)` links it to the catalog definition.

Metadata URIs should be content-addressed IPFS paths. A definition may be
updated until `freezeDefinitionMetadata()` is called; freezing is irreversible.

### Deed model

Large deed payloads stay in IPFS or the Sverse data layer. The registry stores
the payload hash, URI hash, signer addresses, timestamp and token reference.
The full URI is emitted in `DeedRecorded` for indexing.

The studio signs this EIP-712 type:

```text
Deed(
  address collection,
  uint256 tokenId,
  bytes32 deedType,
  bytes32 payloadHash,
  bytes32 uriHash,
  uint256 nonce,
  uint256 deadline
)
```

Configure high-value deed types with `setWitnessRequired`. Those deeds require
both the studio signature and a signer holding `WITNESS_ROLE`.

## Toolchain

- Node.js 20+
- npm 10+
- Hardhat 2
- Solidity 0.8.30
- OpenZeppelin Contracts 5
- EVM target `cancun`, required by the current Avalanche C-Chain toolchain

## Install and test

```bash
npm ci
npm run compile
npm test
npm run test:coverage
```

Tests cover:

- role and studio/game ownership boundaries;
- standard item and unique Living Item minting;
- lifetime supply caps and non-transferable items;
- irreversible metadata freezing and emergency pause;
- primary settlement and atomic minting;
- marketplace escrow, protocol fees, and royalties;
- EIP-712 deed signatures, nonces, and required witnesses;
- funded Merkle epochs, duplicate claims, and expiry recovery.

## Local deployment

Start a local chain in terminal one:

```bash
npm run node
```

Deploy in terminal two:

```bash
npm run deploy:local
```

The script writes addresses to `deployments/localhost.json`.

Grant least-privilege operational roles to a dedicated local relayer wallet:

```bash
RELAYER_ADDRESS=0xYOUR_LOCAL_RELAYER npm run grant:relayer:local
```

When using `transfer` settlement mode (so the relayer should not mint
`MockSRV`), set `SKIP_MOCKSRV_MINTER=true`:

```bash
RELAYER_ADDRESS=0xYOUR_LOCAL_RELAYER SKIP_MOCKSRV_MINTER=true npm run grant:relayer:local
```

The script grants only the minimum operational roles (`SverseItems.MINTER_ROLE`,
`SverseItems.PLATFORM_ROLE`, `SverseDeedRegistry.WITNESS_ROLE`,
`SverseRewards.PUBLISHER_ROLE`, and `MockSRV.MINTER_ROLE` unless
`SKIP_MOCKSRV_MINTER=true`). It never grants `DEFAULT_ADMIN_ROLE` or
`PAUSER_ROLE`, and refuses to run if `RELAYER_ADDRESS` matches the
admin/deployer address (local development can override this guard with
`ALLOW_SAME_ADMIN_RELAYER=true`).

## Avalanche Fuji deployment

Fuji C-Chain configuration:

| Field | Value |
| --- | --- |
| Chain ID | `43113` |
| Currency | Test AVAX |
| RPC | `https://api.avax-test.network/ext/bc/C/rpc` |
| Explorer | `https://subnets-test.avax.network/c-chain` |

Get test AVAX from the
[Avalanche Testnet Faucet](https://core.app/tools/testnet-faucet/?subnet=c&token=c).
Use a dedicated Fuji key. Never reuse a mainnet or personal wallet private key.

Create the local environment file:

```bash
npm run wallet:fuji
```

This creates a dedicated testnet wallet and writes `.env` with file mode `0600`.
It refuses to overwrite an existing `.env` and never prints the private key.
Fund the printed address with test AVAX before deploying.

```dotenv
FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
DEPLOYER_PRIVATE_KEY=0xFUJI_ONLY_PRIVATE_KEY
ADMIN_ADDRESS=0xADMIN_OR_MULTISIG
TREASURY_ADDRESS=0xTREASURY
PROTOCOL_FEE_BPS=250
```

Deploy:

```bash
npm run deploy:fuji
```

The deployment script:

1. deploys all six contracts;
2. grants `SverseStore` permission to mint items;
3. registers `SverseItems` as a trusted deed collection;
4. hands operational and admin roles to `ADMIN_ADDRESS`;
5. renounces deployer roles when the admin differs from the deployer;
6. writes `deployments/fuji.json`.

`deployments/fuji.json` is tracked in git as the public Fuji deployment
manifest, while `deployments/localhost.json` and other network deployment
manifests remain ignored by `.gitignore`.

### Grant relayer operational roles on Fuji

Using the admin/deployer signer configured in `.env`, grant least-privilege
operational roles to a dedicated Fuji relayer wallet:

```bash
RELAYER_ADDRESS=0xYOUR_FUJI_RELAYER npm run grant:relayer:fuji
```

When using `transfer` settlement mode (so the relayer should not mint
`MockSRV`), set `SKIP_MOCKSRV_MINTER=true`:

```bash
RELAYER_ADDRESS=0xYOUR_FUJI_RELAYER SKIP_MOCKSRV_MINTER=true npm run grant:relayer:fuji
```

The script grants only the minimum operational roles (`SverseItems.MINTER_ROLE`,
`SverseItems.PLATFORM_ROLE`, `SverseDeedRegistry.WITNESS_ROLE`,
`SverseRewards.PUBLISHER_ROLE`, and `MockSRV.MINTER_ROLE` unless
`SKIP_MOCKSRV_MINTER=true`). It never grants `DEFAULT_ADMIN_ROLE` or
`PAUSER_ROLE`, verifies both remain absent on every contract, and refuses to
run if `RELAYER_ADDRESS` matches the admin/deployer address.

### Deployed Fuji addresses

Current public Fuji deployment (from [`deployments/fuji.json`](./deployments/fuji.json), chain ID `43113`, deployed `2026-11-17T16:05:14.691Z`):

| Contract | Address | Explorer |
| --- | --- | --- |
| `MockSRV` | `0xe604f4A90aaCBe8AC63fE7610183d75127321e37` | [Snowtrace Testnet](https://subnets-test.avax.network/c-chain/address/0xe604f4A90aaCBe8AC63fE7610183d75127321e37) |
| `SverseItems` | `0xad4210A2764abFd1bD87aC0922261079BC422F4b` | [Snowtrace Testnet](https://subnets-test.avax.network/c-chain/address/0xad4210A2764abFd1bD87aC0922261079BC422F4b) |
| `SverseDeedRegistry` | `0x0345Bd9D7f1453d5B16e46A73F3D679dE308C441` | [Snowtrace Testnet](https://subnets-test.avax.network/c-chain/address/0x0345Bd9D7f1453d5B16e46A73F3D679dE308C441) |
| `SverseStore` | `0xe76a9f90757f458683689031E721cCF8f4D22469` | [Snowtrace Testnet](https://subnets-test.avax.network/c-chain/address/0xe76a9f90757f458683689031E721cCF8f4D22469) |
| `SverseMarketplace` | `0x5C9dB40EB57aCA7774B1FF3384855156e2259699` | [Snowtrace Testnet](https://subnets-test.avax.network/c-chain/address/0x5C9dB40EB57aCA7774B1FF3384855156e2259699) |
| `SverseRewards` | `0x26141f4F6C9a8Af5BD3A30565Fee8d551bEb7688` | [Snowtrace Testnet](https://subnets-test.avax.network/c-chain/address/0x26141f4F6C9a8Af5BD3A30565Fee8d551bEb7688) |

## Contract verification

After deploying to Fuji:

```bash
npm run verify:fuji
```

The verification script reads `deployments/fuji.json` and submits every
contract with its constructor arguments. If API verification is unavailable,
use the official Avalanche Explorer verification UI with the Hardhat build
metadata from `artifacts/build-info`.

## Roles

| Contract | Role | Purpose |
| --- | --- | --- |
| All | `DEFAULT_ADMIN_ROLE` | Grants and revokes contract roles. Use a multisig before mainnet. |
| `MockSRV` | `MINTER_ROLE` | Test token issuance. |
| `SverseItems` | `PLATFORM_ROLE` | Registers studios/games and manages definitions when needed. |
| `SverseItems` | `MINTER_ROLE` | Mints catalog items; assigned to `SverseStore`. |
| `SverseDeedRegistry` | `CONFIG_ROLE` | Trusts collections and configures witness requirements. |
| `SverseDeedRegistry` | `WITNESS_ROLE` | Co-signs high-value deeds. |
| `SverseStore` | `CATALOG_ROLE` | Creates and updates primary-sale offers. |
| `SverseRewards` | `PUBLISHER_ROLE` | Funds and publishes reward epochs. |
| Relevant contracts | `PAUSER_ROLE` | Emergency stop for state-changing user flows. |

`SverseItems` also maps each studio ID to one wallet and each game ID to its
studio. A studio may only create definitions for its own registered games.
Use multisig studio wallets where operational continuity matters.

## Backend integration

Sync compiled contract ABIs into `../backend-v2/src/adapters/chain/abi` after contract changes:

```bash
npm run export:abi
```

Only the chain adapter should import ethers and contract ABIs:

```text
checkout.service -> AvalancheChainAdapter -> SverseStore
market.service   -> AvalancheChainAdapter -> SverseMarketplace
deeds.service    -> AvalancheChainAdapter -> SverseDeedRegistry
rewards.service  -> AvalancheChainAdapter -> SverseRewards
```

Do not hold a MongoDB transaction open while waiting for a chain receipt.
Persist an outbox command and use an idempotent state machine:

```text
created -> submitted -> chain_confirmed -> completed
                   \-> failed -> refunded
```

Index these events back into MongoDB:

- `ItemMinted`, `ItemPurchased`;
- `ListingCreated`, `ListingCancelled`, `ListingSold`;
- `DeedRecorded`;
- `EpochPublished`, `RewardClaimed`, `EpochReclaimed`.

Wait for the configured confirmation depth before marking business operations
final, and run a reconciliation worker for submitted transactions.

## Security decisions

- Contracts are non-upgradeable for the initial release.
- Protocol fees are capped at 10% on-chain.
- NFT royalties are capped at 20% on-chain.
- Store and marketplace settlement use `SafeERC20` and `ReentrancyGuard`.
- Marketplace listings use NFT escrow to prevent stale ownership listings.
- Deed nonces are scoped by collection and token ID.
- Metadata freezing is irreversible.
- Reward roots are immutable after publication and fully funded at publication.
- All user-facing state changes have emergency pause controls where appropriate.

## Mainnet checklist

Before an Avalanche C-Chain mainnet deployment:

1. Replace `MockSRV` with the audited settlement asset decision.
2. Obtain an independent smart-contract audit.
3. Add invariant and fuzz campaigns for accounting and supply rules.
4. Move admin, treasury, publisher, witness and pauser roles to reviewed multisigs.
5. Document key rotation, incident response and pause/unpause procedures.
6. Pin all production metadata and deed payloads redundantly.
7. Run a complete Fuji dress rehearsal, including failed and replaced transactions.
8. Publish verified source, deployment manifests, compiler settings and role assignments.

## License

MIT. See [LICENSE](./LICENSE).
