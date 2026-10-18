import type { InterfaceAbi } from "ethers";

export type Deployment = { address: string; chainId: number; abi: InterfaceAbi };
export type EscrowRow = {
  id: bigint;
  buyer: string;
  seller: string;
  amount: bigint;
  refundDeadline: bigint;
  status: number;
  description: string;
};
export type HistoryRow = {
  escrowId: bigint;
  name: string;
  detail: string;
  hash: string;
  blockNumber: number;
};
