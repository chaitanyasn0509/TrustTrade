import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("TrustTradeEscrow", deployer);
  const escrow = await factory.deploy();
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "TrustTradeEscrow.sol", "TrustTradeEscrow.json");
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const outputPath = path.join(__dirname, "..", "frontend", "public", "contract-deployment.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ address, chainId: 31337, abi: artifact.abi }, null, 2));
  console.log(`TrustTradeEscrow deployed to: ${address}`);
  console.log(`Arbitrator (deployer): ${deployer.address}`);
  console.log(`Local frontend configuration written to: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
