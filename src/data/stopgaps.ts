// Stopgap nests: subgraphs The Graph network does not serve, answered from a nuthatch nest until an
// indexer allocates. One entry per deployment; the page at /subgraphs/<deployment> is built from it.
export interface Example { title: string; query: string; variables?: string }
export interface Stopgap {
  deployment: string;
  name: string;
  chain: string;
  since: string;
  lastActivity: string;
  record: string;
  entities: string[];
  refused: { field: string; why: string }[];
  examples: Example[];
}

export const ENDPOINT_BASE = 'https://subgraphs.nuthatch-indexer.com/subgraphs/id/';

export const stopgaps: Stopgap[] = [
  {
    deployment: 'QmXsbGm5Mbm9H5HWrt11uwWSf58MyaxjspF4TNYx166Xgz',
    name: 'openloom-bsc',
    chain: 'BNB Smart Chain',
    since: '2026-10-08',
    lastActivity: '2026-05-19',
    record: 'https://github.com/nightswatchhq/graph-support/issues/53',
    entities: ['Card', 'Medal', 'Minter', 'MintPool', 'Token', 'Mint', 'Subscribe', 'Ransom', 'BoardRelease', 'Reward', 'Brokerage', 'Harvest', 'Distribute'],
    refused: [
      { field: 'DailyState', why: 'day-keyed running totals the mapping accumulates; refused by name rather than approximated' },
      { field: 'Distribute.operator', why: 'the transaction sender, which this nest does not store' },
    ],
    examples: [
      { title: 'Cards owned by an address', query: `query CardsByOwner($owner: Bytes!) {
  cards(first: 100, where: { owner: $owner }, orderBy: cardId) {
    id owner nickname cardId imageIndex parentCardId createAt
  }
}`, variables: '{ "owner": "0xfebdea0cb339a8c60a6a4bbbdadf88513e6766f6" }' },
      { title: 'The token', query: `{ tokens { id name sysmbol totalSupply token medal board forge bonus achievement createAt } }` },
      { title: 'Newest mint pools', query: `{ mintPools(first: 20, orderBy: createAt, orderDirection: desc) { id token index totalSupply createAt } }` },
      { title: 'Recent mints, subscribes and ransoms', query: `{
  mints(first: 10, orderBy: createAt, orderDirection: desc) { id owner cardId cardIndex usdtAmount tokenAmount createAt }
  subscribes(first: 10, orderBy: createAt, orderDirection: desc) { id owner cardId cardIndex amount createAt }
  ransoms(first: 10, orderBy: createAt, orderDirection: desc) { id owner cardId cardIndex amount createAt }
}` },
      { title: 'Rewards, brokerage, harvests and board releases', query: `{
  rewards(first: 10, orderBy: createAt, orderDirection: desc) { id token cardId amount createAt }
  brokerages(first: 10, orderBy: createAt, orderDirection: desc) { id owner cardId amount createAt }
  harvests(first: 10, orderBy: createAt, orderDirection: desc) { id owner medalId amount createAt }
  boardReleases(first: 10, orderBy: createAt, orderDirection: desc) { id useTvl totalTvl releaseTokenAmount hash createAt }
}` },
      { title: 'Medals owned by an address', query: `query MedalsByOwner($owner: Bytes!) {
  medals(first: 100, where: { owner: $owner }) { id medal owner medalId medalType createAt }
}`, variables: '{ "owner": "0x266749d555f5c794c27c8a440876730247e62310" }' },
      { title: 'Latest distributions', query: `{ distributes(first: 10, orderBy: blockNumber, orderDirection: desc) { id token hash txHash blockNumber index poolId distributeRadio amount createAt } }` },
    ],
  },
];
