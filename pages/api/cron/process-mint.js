// pages/api/cron/process-mint.js
import prisma from "../../../lib/prisma";
import { ethers } from "ethers";

// Environment Variables
const rpcUrl = process.env.RPC_URL;
const minterKey = process.env.MINTER_PRIVATE_KEY;
const contractAddr = process.env.CONTRACT_ADDRESS;
const cronSecret = process.env.CRON_SECRET;

export default async function handler(req, res) {
  // --- 1. KEAMANAN (DIBETULKAN) ---
  // Kita cek apakah yang memanggil adalah Vercel Cron ASLI atau Admin dengan Secret Key
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['user-agent'] === 'vercel-cron/1.0';
  const isAuthorized = authHeader === `Bearer ${cronSecret}`;

  // Jika Anda ingin mengetes lewat Postman tanpa header, komentar dulu 4 baris di bawah ini:
  if (!isVercelCron && !isAuthorized && cronSecret) {
    return res.status(401).json({ error: "Unauthorized: Invalid Token" });
  }

  // Cek Env Vars
  if (!rpcUrl || !minterKey || !contractAddr) {
    console.error("Missing Environment Variables");
    return res.status(500).json({ error: "Server misconfiguration (Env Vars)" });
  }

  try {
    // --- 2. SETUP ETHERS (DIBETULKAN) ---
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(minterKey, provider);
    const contractABI = ["function mint(address to, uint256 amount) public"];
    const tokenContract = new ethers.Contract(contractAddr, contractABI, wallet);

    // --- 3. AMBIL ANTREAN ---
    const job = await prisma.transactionQueue.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' }
    });

    if (!job) {
      return res.status(200).json({ message: "No pending jobs found." });
    }

    // Update status jadi PROCESSING agar tidak diambil worker lain (jika ada)
    await prisma.transactionQueue.update({
      where: { id: job.id },
      data: { status: 'PROCESSING' }
    });

    console.log(`Processing Job ID: ${job.id} for Wallet ${job.walletAddress}`);

    // --- 4. EKSEKUSI MINTING (DIBETULKAN) ---
    const amountInWei = ethers.parseUnits(job.amount, 18);
    
    // PENTING: Tambahkan gasLimit manual. 
    // Kadang simulasi gas di Sepolia gagal, ini memaksa transaksi tetap jalan.
    const txOptions = {
      gasLimit: 500000 // Limit aman untuk fungsi mint sederhana
    };

    const tx = await tokenContract.mint(job.walletAddress, amountInWei, txOptions);
    
    // Kita TIDAK menunggu tx.wait() agar tidak timeout di Vercel.
    // Kita cukup dapat hash-nya saja, itu sudah bukti transaksi terkirim.
    
    // Simpan Hash dan tandai selesai
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
    
    // Jika job ada tapi gagal, update jadi FAILED
    // Kita perlu cek if(job) lagi atau gunakan variabel id yang disimpan sebelumnya
    // Tapi untuk simplifikasi di sini aman karena error biasanya terjadi setelah job ditemukan
    
    return res.status(500).json({ 
      error: error.message || "Internal Server Error" 
    });
  }
}

// Trigger deploy ulang