import { historyClient } from "@/chain/history-client";
import { CHAIN, DEPLOY_BLOCK, SETTLANE_ADDRESS } from "@/config/chain";
import { createHistory } from "./history";

/**
 * The application's one history engine (one per server process, one per browser tab): the verified snapshot plus a
 * live scan through `historyClient`. Everything that shows events reads this, through `getHistory` (server) or
 * `useHistory` (browser).
 */
export const history = createHistory({
  chainId: CHAIN.id,
  address: SETTLANE_ADDRESS,
  deployBlock: DEPLOY_BLOCK,
  source: {
    // cacheTime 0: viem otherwise answers a repeated head request from a 4 s cache, so a scan started right after a
    // transaction confirmed stopped one block short and missed it (found in the wallet browser test).
    getBlockNumber: () => historyClient.getBlockNumber({ cacheTime: 0 }),
    getLogs: ({ fromBlock, toBlock }) => historyClient.getLogs({ address: SETTLANE_ADDRESS, fromBlock, toBlock }),
    getBlock: ({ blockNumber }) => historyClient.getBlock({ blockNumber }),
  },
});
