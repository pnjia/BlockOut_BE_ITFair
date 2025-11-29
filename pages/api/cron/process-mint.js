import prisma from "../../../lib/prisma";
import { ethers } from "ethers";

const rpcUrl = process.env.RPC_URL;
const minterKey = process.env.MINTER_PRIVATE_KEY;
const contractAddr = process.env.CONTRACT_ADDRESS;

export default async function handler(req, res) {

  const authHeader = req.headers.authorization;
  if (req.headers['user-agent'] !== 'vercel-cron/1.0' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
  }

  if (!rpcUrl || !minterKey || !contractAddr) {
    return res.status(500).json({ error: "Environment variables missing" });
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(minterKey, provider);
  const contractABI = ["function mint(address to, uint256 amount) public"];
  const tokenContract = new ethers.Contract(contractAddr, contractABI, wallet);

  const job = await prisma.transactionQueue.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' }
  });

  if (!job) {
    return res.status(200).json({ message: "No pending jobs found." });
  }

  try {
    await prisma.transactionQueue.update({
      where: { id: job.id },
      data: { status: 'PROCESSING' }
    });

    console.log(`Processing Job ID: ${job.id} for User ${job.userId}`);

    const amountInWei = ethers.parseUnits(job.amount, 18);
    
    const tx = await tokenContract.mint(job.walletAddress, amountInWei);
    
    await prisma.transactionQueue.update({
      where: { id: job.id },
      data: { 
        status: 'COMPLETED',
        txHash: tx.hash
      }
    });

    return res.status(200).json({ 
      success: true, 
      message: `Job ${job.id} sent to blockchain`, 
      txHash: tx.hash 
    });

  } catch (error) {
    console.error(`Job ${job.id} Failed:`, error.message);
    
    await prisma.transactionQueue.update({
      where: { id: job.id },
      data: { 
        status: 'FAILED',
        errorMessage: error.message
      }
    });

    return res.status(500).json({ error: error.message });
  }
}