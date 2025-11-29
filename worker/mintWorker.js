const { PrismaClient } = require('@prisma/client');
const { ethers } = require('ethers');
require('dotenv').config({ path: '.env.local' });

const prisma = new PrismaClient();

const rpcUrl = process.env.RPC_URL;
const minterKey = process.env.MINTER_PRIVATE_KEY;
const contractAddr = process.env.CONTRACT_ADDRESS;

if (!rpcUrl || !minterKey || !contractAddr) {
  console.error("ERROR: Missing ENV Variables in .env.local");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(minterKey, provider);
const contractABI = ["function mint(address to, uint256 amount) public"];
const tokenContract = new ethers.Contract(contractAddr, contractABI, wallet);

async function processQueue() {
  const job = await prisma.transactionQueue.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' }
  });

  if (!job) return;

  console.log(`Processing Job ID: ${job.id} for User ${job.userId}`);

  try {
    await prisma.transactionQueue.update({
      where: { id: job.id },
      data: { status: 'PROCESSING' }
    });

    const amountInWei = ethers.parseUnits(job.amount, 18);
    const tx = await tokenContract.mint(job.walletAddress, amountInWei);
    
    await tx.wait(1);

    await prisma.transactionQueue.update({
      where: { id: job.id },
      data: { 
        status: 'COMPLETED',
        txHash: tx.hash
      }
    });
    console.log(`Job ${job.id} Completed. Tx: ${tx.hash}`);

  } catch (error) {
    console.error(`Job ${job.id} Failed:`, error.message);
    
    await prisma.transactionQueue.update({
      where: { id: job.id },
      data: { 
        status: 'FAILED',
        errorMessage: error.message
      }
    });
  }
}

console.log("Worker started...");
setInterval(processQueue, 5000);