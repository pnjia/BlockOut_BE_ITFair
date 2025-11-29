// pages/api/cron/process-mint.js
import prisma from "../../../lib/prisma";
import { ethers } from "ethers";

const rpcUrl = process.env.RPC_URL;
const minterKey = process.env.MINTER_PRIVATE_KEY;
const contractAddr = process.env.CONTRACT_ADDRESS;
const cronSecret = process.env.CRON_SECRET;

export default async function handler(req, res) {

  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['user-agent'] === 'vercel-cron/1.0';
  const isAuthorized = authHeader === `Bearer ${cronSecret}`;

  if (!isVercelCron && !isAuthorized && cronSecret) {
    return res.status(401).json({ error: "Unauthorized: Invalid Token" });
  }

  if (!rpcUrl || !minterKey || !contractAddr) {
    console.error("Missing Environment Variables");
    return res.status(500).json({ error: "Server misconfiguration (Env Vars)" });
  }

  try {
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

    await prisma.transactionQueue.update({
      where: { id: job.id },
      data: { status: 'PROCESSING' }
    });

    console.log(`Processing Job ID: ${job.id} for Wallet ${job.walletAddress}`);

    const amountInWei = ethers.parseUnits(job.amount, 18);

    const txOptions = {
      gasLimit: 500000 
    };

    const tx = await tokenContract.mint(job.walletAddress, amountInWei, txOptions);
    
    await prisma.transactionQueue.update({
      where: { id: job.id },
      data: { 
        status: 'COMPLETED',
        txHash: tx.hash
      }
    });

    return res.status(200).json({ 
      success: true, 
      message: `Job ${job.id} broadcasted to blockchain`, 
      txHash: tx.hash 
    });

  } catch (error) {
    console.error(`Job Failed:`, error);
    
    return res.status(500).json({ 
      error: error.message || "Internal Server Error" 
    });
  }
}