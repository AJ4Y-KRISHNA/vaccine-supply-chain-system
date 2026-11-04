const { ethers } = require("ethers");
require("dotenv").config();

// Hardhat local blockchain
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

// wallet private key (hardhat account)
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Smart Contract Address
const contractAddress = process.env.CONTRACT_ADDRESS;

// ABI
const contractABI = [

{
 inputs:[
  {internalType:"string",name:"batchId",type:"string"},
  {internalType:"string",name:"vaccineType",type:"string"},
  {internalType:"uint256",name:"quantity",type:"uint256"}
 ],
 name:"registerBatch",
 outputs:[],
 stateMutability:"nonpayable",
 type:"function"
},

{
 inputs:[{internalType:"string",name:"batchId",type:"string"}],
 name:"getBatch",
 outputs:[
  {internalType:"string",name:"",type:"string"},
  {internalType:"string",name:"",type:"string"},
  {internalType:"uint256",name:"",type:"uint256"}
 ],
 stateMutability:"view",
 type:"function"
},

{
 inputs:[
  {internalType:"string",name:"shipmentId",type:"string"},
  {internalType:"string",name:"batchId",type:"string"},
  {internalType:"string",name:"distributor",type:"string"},
  {internalType:"string",name:"destination",type:"string"}
 ],
 name:"createShipment",
 outputs:[],
 stateMutability:"nonpayable",
 type:"function"
},

{
 inputs:[
  {internalType:"string",name:"shipmentId",type:"string"},
  {internalType:"string",name:"status",type:"string"}
 ],
 name:"updateShipmentStatus",
 outputs:[],
 stateMutability:"nonpayable",
 type:"function"
},

{
 inputs:[{internalType:"string",name:"shipmentId",type:"string"}],
 name:"getShipment",
 outputs:[
  {internalType:"string",name:"",type:"string"},
  {internalType:"string",name:"",type:"string"},
  {internalType:"string",name:"",type:"string"},
  {internalType:"string",name:"",type:"string"},
  {internalType:"string",name:"",type:"string"}
 ],
 stateMutability:"view",
 type:"function"
}

];

// Contract instance
const contract = new ethers.Contract(contractAddress, contractABI, wallet);

module.exports = contract;
