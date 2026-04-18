import os
import logging
from typing import Optional

logger = logging.getLogger("oracle.blockchain")

try:
    from web3 import Web3  # type: ignore
except ImportError:
    Web3 = None  # graceful fallback


def _build_web3():
    if not Web3:
        logger.warning("web3.py not installed; blockchain calls will be skipped.")
        return None, None

    rpc = os.getenv("WEB3_RPC_URL")
    pk = os.getenv("WEB3_PRIVATE_KEY")
    if not rpc or not pk:
        logger.warning("WEB3_RPC_URL or WEB3_PRIVATE_KEY missing; skipping tx.")
        return None, None

    w3 = Web3(Web3.HTTPProvider(rpc))
    acct = w3.eth.account.from_key(pk)
    return w3, acct


def request_new_batch(predicted_demand: float, current_stock: float, target_center: str = "UNKNOWN") -> Optional[str]:
    """
    Optionally invoke Solidity oracle (e.g., requestNewBatch) on Sepolia/Mainnet.
    Requires ENV: WEB3_RPC_URL, WEB3_PRIVATE_KEY, CONTRACT_ADDRESS, CONTRACT_ABI_PATH.
    Returns transaction hash or None if skipped.
    """
    w3, acct = _build_web3()
    if not w3:
        return None

    address = os.getenv("CONTRACT_ADDRESS")
    abi_path = os.getenv("CONTRACT_ABI_PATH")
    if not address or not abi_path or not os.path.exists(abi_path):
        logger.warning("Contract address/ABI missing; skipping tx.")
        return None

    import json

    with open(abi_path, "r") as f:
        abi = json.load(f)
        if isinstance(abi, dict) and "abi" in abi:
            abi = abi["abi"]

    contract = w3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)

    try:
        nonce = w3.eth.get_transaction_count(acct.address)
        tx = contract.functions.requestNewBatch(
            int(predicted_demand),
            int(current_stock),
            target_center,
        ).build_transaction(
            {
                "from": acct.address,
                "nonce": nonce,
                "gas": 800000,
                "maxFeePerGas": w3.to_wei("30", "gwei"),
                "maxPriorityFeePerGas": w3.to_wei("2", "gwei"),
            }
        )
        signed = acct.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.rawTransaction)
        logger.info("Submitted requestNewBatch tx %s", tx_hash.hex())
        return tx_hash.hex()
    except Exception as exc:
        logger.error("Blockchain tx failed: %s", exc)
        return None
