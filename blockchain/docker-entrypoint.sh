#!/bin/sh
set -eu

npx hardhat compile
mkdir -p /shared-artifacts
cp -R artifacts/. /shared-artifacts/
npx hardhat node --hostname 0.0.0.0 > /tmp/hardhat-node.log 2>&1 &
hardhat_pid=$!
trap 'kill "$hardhat_pid" 2>/dev/null || true; wait "$hardhat_pid" 2>/dev/null || true' INT TERM

attempt=0
until node -e 'fetch("http://127.0.0.1:8545",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"eth_chainId",params:[]})}).then(r=>r.json()).then(j=>{if(j.result!=="0x7a69")process.exit(1)}).catch(()=>process.exit(1))'; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    cat /tmp/hardhat-node.log
    exit 1
  fi
  sleep 1
done
npx hardhat run scripts/deploy.js --network localhost
wait "$hardhat_pid"
